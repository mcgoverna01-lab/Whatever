import { query } from '../db/pool.js';
import { syncBootstrap, syncGameweekStats, getCurrentGameweek } from '../sync/fpl-sync.js';
import { processWaiverClaims } from '../waivers/waiver-processor.js';
import { processFaabBids } from '../waivers/faab-processor.js';
import { scoreGameweek } from '../scoring/scoring-engine.js';
import { calculateH2HResults } from '../h2h/h2h-engine.js';
import { processExpiredVetoPeriods } from '../trades/trade-engine.js';

interface SchedulerConfig {
  /** Bootstrap sync interval in ms (default: 6 hours) */
  bootstrapIntervalMs: number;
  /** Live stats sync interval in ms (default: 5 minutes during matches) */
  liveStatsIntervalMs: number;
  /** Waiver processing check interval in ms (default: 1 minute) */
  waiverCheckIntervalMs: number;
  /** Trade veto check interval in ms (default: 5 minutes) */
  tradeCheckIntervalMs: number;
}

const DEFAULT_CONFIG: SchedulerConfig = {
  bootstrapIntervalMs: 6 * 60 * 60 * 1000,   // 6 hours
  liveStatsIntervalMs: 5 * 60 * 1000,         // 5 minutes
  waiverCheckIntervalMs: 60 * 1000,            // 1 minute
  tradeCheckIntervalMs: 5 * 60 * 1000,         // 5 minutes
};

/**
 * Central scheduler for all background processing.
 *
 * Runs these jobs:
 * 1. Bootstrap sync — refresh player profiles from FPL every 6h
 * 2. Live stats sync — pull gameweek stats every 5min during active GWs
 * 3. Waiver/FAAB processing — check for pending claims at deadlines
 * 4. Scoring — recalculate team scores when new stats arrive
 * 5. H2H results — update matchup outcomes after scoring
 * 6. Trade veto expiry — complete accepted trades past veto deadline
 *
 * NOT a cron daemon — uses setInterval. In production, you'd move
 * this to a dedicated worker process or use pg_cron / BullMQ.
 */
export class Scheduler {
  private intervals: ReturnType<typeof setInterval>[] = [];
  private running = false;
  private config: SchedulerConfig;

  constructor(config: Partial<SchedulerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  start(): void {
    if (this.running) return;
    this.running = true;

    console.log('[scheduler] Starting background jobs');

    // 1. Bootstrap sync
    this.intervals.push(
      setInterval(() => this.runBootstrapSync(), this.config.bootstrapIntervalMs),
    );
    // Run immediately on start
    this.runBootstrapSync();

    // 2. Live stats + scoring + H2H (chained)
    this.intervals.push(
      setInterval(() => this.runLiveStatsCycle(), this.config.liveStatsIntervalMs),
    );

    // 3. Waiver/FAAB processing
    this.intervals.push(
      setInterval(() => this.runWaiverProcessing(), this.config.waiverCheckIntervalMs),
    );

    // 4. Trade veto expiry
    this.intervals.push(
      setInterval(() => this.runTradeProcessing(), this.config.tradeCheckIntervalMs),
    );
  }

  stop(): void {
    this.running = false;
    for (const interval of this.intervals) {
      clearInterval(interval);
    }
    this.intervals = [];
    console.log('[scheduler] Stopped');
  }

  // ── Job: Bootstrap Sync ──────────────────────────────────────

  private async runBootstrapSync(): Promise<void> {
    try {
      const result = await syncBootstrap();
      console.log(`[scheduler:bootstrap] Synced ${result.playersUpdated} players`);
    } catch (err) {
      console.error('[scheduler:bootstrap] Failed:', err);
    }
  }

  // ── Job: Live Stats → Scoring → H2H ─────────────────────────

  private async runLiveStatsCycle(): Promise<void> {
    try {
      const gw = await getCurrentGameweek();

      // Only sync if current GW is not finished (matches in progress)
      // or if it just finished (to capture final bonus points)
      const result = await syncGameweekStats(gw.current);
      if (result.playersUpdated === 0) return;

      console.log(`[scheduler:live] GW${gw.current}: synced ${result.playersUpdated} player stats`);

      // Re-score all active leagues for this gameweek
      await this.scoreActiveLeagues(gw.current);

      // Update H2H results
      await this.updateH2HForActiveLeagues(gw.current);
    } catch (err) {
      console.error('[scheduler:live] Failed:', err);
    }
  }

  private async scoreActiveLeagues(gameweek: number): Promise<void> {
    const leagues = await query<{ id: string }>(
      `SELECT id FROM leagues WHERE status = 'active'`,
    );

    for (const league of leagues.rows) {
      try {
        await scoreGameweek(league.id, gameweek);
      } catch (err) {
        console.error(`[scheduler:scoring] League ${league.id} GW${gameweek}:`, err);
      }
    }
  }

  private async updateH2HForActiveLeagues(gameweek: number): Promise<void> {
    const leagues = await query<{ id: string }>(
      `SELECT id FROM leagues WHERE status = 'active'
       AND scoring_mode IN ('h2h', 'h2h_and_total')`,
    );

    for (const league of leagues.rows) {
      try {
        await calculateH2HResults(league.id, gameweek);
      } catch (err) {
        console.error(`[scheduler:h2h] League ${league.id} GW${gameweek}:`, err);
      }
    }
  }

  // ── Job: Waiver/FAAB Processing ──────────────────────────────

  private async runWaiverProcessing(): Promise<void> {
    try {
      const gw = await getCurrentGameweek();

      // Find leagues with waiver deadlines that have passed
      // Waiver deadline: the specified day of the week for the current GW
      const now = new Date();
      const currentDay = now.getUTCDay() || 7; // 1=Mon ... 7=Sun

      const leagues = await query<{
        id: string;
        waiver_deadline_day: number | null;
      }>(
        `SELECT id, waiver_deadline_day FROM leagues
         WHERE status = 'active' AND waiver_deadline_day IS NOT NULL`,
      );

      for (const league of leagues.rows) {
        // Only process on the deadline day
        if (league.waiver_deadline_day !== currentDay) continue;

        // Check if we already processed this GW's waivers
        const alreadyProcessed = await query(
          `SELECT 1 FROM waiver_claims
           WHERE league_id = $1 AND gameweek = $2 AND status != 'pending'
           LIMIT 1`,
          [league.id, gw.current],
        );
        if (alreadyProcessed.rows.length > 0) continue;

        // Check for pending claims
        const hasPending = await query(
          `SELECT 1 FROM waiver_claims
           WHERE league_id = $1 AND gameweek = $2 AND status = 'pending'
           LIMIT 1`,
          [league.id, gw.current],
        );
        if (hasPending.rows.length === 0) continue;

        try {
          // Process standard waivers first
          const waiverResult = await processWaiverClaims(league.id, gw.current);
          console.log(
            `[scheduler:waivers] League ${league.id} GW${gw.current}: ` +
            `${waiverResult.approved} approved, ${waiverResult.rejected} rejected`,
          );

          // Then FAAB bids
          const faabResult = await processFaabBids(league.id, gw.current);
          if (faabResult.approved > 0 || faabResult.rejected > 0) {
            console.log(
              `[scheduler:faab] League ${league.id} GW${gw.current}: ` +
              `${faabResult.approved} approved, ${faabResult.rejected} rejected`,
            );
          }
        } catch (err) {
          console.error(`[scheduler:waivers] League ${league.id}:`, err);
        }
      }
    } catch (err) {
      console.error('[scheduler:waivers] Failed:', err);
    }
  }

  // ── Job: Trade Processing ────────────────────────────────────

  private async runTradeProcessing(): Promise<void> {
    try {
      const processed = await processExpiredVetoPeriods();
      if (processed > 0) {
        console.log(`[scheduler:trades] Completed ${processed} trades past veto deadline`);
      }
    } catch (err) {
      console.error('[scheduler:trades] Failed:', err);
    }
  }
}

export const scheduler = new Scheduler();
