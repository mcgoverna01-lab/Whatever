import { query } from '../../db/pool.js';
import type { ProjectionContext, PlayerProjection } from '../types.js';
import type { ProjectionEngine } from './engine.js';

/**
 * Projection accuracy tracker.
 *
 * Records projected points before each gameweek and compares them to
 * actual FPL scores afterwards. Accuracy data accumulates over the season,
 * enabling the heuristic weights to be tuned (or the AI engine prompted
 * with "your last 5 predictions were X% off for defenders").
 *
 * DB table (auto-created if missing):
 *
 *   projection_snapshots(
 *     id          SERIAL PRIMARY KEY,
 *     engine      TEXT NOT NULL,          -- 'heuristic' | 'ai'
 *     gameweek    INT  NOT NULL,
 *     player_id   INT  NOT NULL,
 *     projected   FLOAT NOT NULL,         -- projected points for the GW
 *     actual      FLOAT,                  -- filled in after GW completes
 *     created_at  TIMESTAMPTZ DEFAULT now()
 *   )
 *
 * Usage:
 *   // Before GW kicks off
 *   await tracker.saveSnapshot(engine, ctx, playerIds);
 *
 *   // After GW is fully processed
 *   await tracker.recordActuals(ctx, completedGw);
 *
 *   // View engine accuracy report
 *   const report = await tracker.getAccuracyReport('heuristic', 10);
 */
export class ProjectionTracker {

  // ── Schema ────────────────────────────────────────────────────

  async ensureTable(): Promise<void> {
    await query(`
      CREATE TABLE IF NOT EXISTS projection_snapshots (
        id         SERIAL PRIMARY KEY,
        engine     TEXT        NOT NULL,
        gameweek   INT         NOT NULL,
        player_id  INT         NOT NULL,
        projected  FLOAT       NOT NULL,
        actual     FLOAT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (engine, gameweek, player_id)
      )
    `);
    await query(`
      CREATE INDEX IF NOT EXISTS projection_snapshots_gw_idx
        ON projection_snapshots (gameweek, engine)
    `);
  }

  // ── Save projections ──────────────────────────────────────────

  /**
   * Save projected points for every player before the gameweek starts.
   * Only saves players on active rosters in the system (via roster_slots).
   */
  async saveSnapshot(
    engine: ProjectionEngine,
    ctx: ProjectionContext,
    playerIds?: number[],
  ): Promise<number> {
    const targetIds = playerIds ?? Array.from(ctx.players.keys());

    // Check whether a snapshot already exists for this engine + GW
    const existing = await query(
      `SELECT COUNT(*) AS cnt FROM projection_snapshots
       WHERE engine = $1 AND gameweek = $2`,
      [engine.name, ctx.currentGameweek],
    ).catch(() => null);

    if ((existing?.rows[0]?.cnt ?? 0) > 0) {
      return 0; // Already snapshotted
    }

    let saved = 0;
    const batchSize = 100;

    for (let i = 0; i < targetIds.length; i += batchSize) {
      const batch = targetIds.slice(i, i + batchSize);
      const projections: PlayerProjection[] = batch
        .map((id) => {
          try {
            return engine.projectPlayer(id, ctx);
          } catch {
            return null;
          }
        })
        .filter((p): p is PlayerProjection => p !== null);

      if (projections.length === 0) continue;

      const values = projections
        .map((_, j) => {
          const base = j * 4;
          return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`;
        })
        .join(', ');

      const params: (string | number)[] = [];
      for (const p of projections) {
        params.push(engine.name, ctx.currentGameweek, p.playerId, p.ppg);
      }

      await query(
        `INSERT INTO projection_snapshots (engine, gameweek, player_id, projected)
         VALUES ${values}
         ON CONFLICT (engine, gameweek, player_id) DO NOTHING`,
        params,
      ).catch(() => null);

      saved += projections.length;
    }

    return saved;
  }

  // ── Record actuals ────────────────────────────────────────────

  /**
   * After a gameweek completes, fill in actual_points for all snapshots
   * that were saved for that GW.
   *
   * Actual points come from the FPL live API (already in ctx.recentStats).
   */
  async recordActuals(ctx: ProjectionContext, completedGw: number): Promise<number> {
    const gwStats = new Map<number, number>();

    for (const [playerId, stats] of ctx.recentStats) {
      const gwStat = stats.find((s) => s.gameweek === completedGw);
      if (gwStat) gwStats.set(playerId, gwStat.totalPoints);
    }

    if (gwStats.size === 0) return 0;

    let updated = 0;
    for (const [playerId, actualPoints] of gwStats) {
      const result = await query(
        `UPDATE projection_snapshots
         SET actual = $1
         WHERE gameweek = $2 AND player_id = $3 AND actual IS NULL`,
        [actualPoints, completedGw, playerId],
      ).catch(() => null);
      updated += result?.rowCount ?? 0;
    }

    return updated;
  }

  // ── Accuracy reports ─────────────────────────────────────────

  /**
   * Get an accuracy report for an engine over the last N gameweeks.
   *
   * Returns:
   *   - MAE (mean absolute error): avg |projected - actual|
   *   - RMSE: sqrt(avg (projected - actual)^2) — penalises big misses more
   *   - Bias: avg (projected - actual) — positive means over-projecting
   *   - Breakdown by position
   *   - Top 10 biggest misses
   */
  async getAccuracyReport(
    engineName: string,
    lastNGameweeks = 10,
  ): Promise<AccuracyReport> {
    const rows = await query(
      `SELECT ps.gameweek, ps.player_id, ps.projected, ps.actual
       FROM projection_snapshots ps
       WHERE ps.engine = $1
         AND ps.actual IS NOT NULL
       ORDER BY ps.gameweek DESC
       LIMIT $2`,
      [engineName, lastNGameweeks * 700], // ~700 players per GW
    ).catch(() => ({ rows: [] as any[] }));

    if (rows.rows.length === 0) {
      return {
        engine: engineName,
        gameweeks: 0,
        sampleSize: 0,
        mae: null,
        rmse: null,
        bias: null,
        byGameweek: [],
        biggestMisses: [],
      };
    }

    const errors = rows.rows.map((r: any) => ({
      gameweek: r.gameweek as number,
      playerId: r.player_id as number,
      projected: parseFloat(r.projected),
      actual: parseFloat(r.actual),
      error: parseFloat(r.projected) - parseFloat(r.actual),
      absError: Math.abs(parseFloat(r.projected) - parseFloat(r.actual)),
    }));

    const mae = errors.reduce((s, e) => s + e.absError, 0) / errors.length;
    const rmse = Math.sqrt(errors.reduce((s, e) => s + e.error ** 2, 0) / errors.length);
    const bias = errors.reduce((s, e) => s + e.error, 0) / errors.length;

    // Group by gameweek
    const gwMap = new Map<number, typeof errors>();
    for (const e of errors) {
      if (!gwMap.has(e.gameweek)) gwMap.set(e.gameweek, []);
      gwMap.get(e.gameweek)!.push(e);
    }

    const byGameweek = Array.from(gwMap.entries())
      .sort(([a], [b]) => b - a)
      .slice(0, lastNGameweeks)
      .map(([gw, es]) => ({
        gameweek: gw,
        mae: es.reduce((s, e) => s + e.absError, 0) / es.length,
        bias: es.reduce((s, e) => s + e.error, 0) / es.length,
        sampleSize: es.length,
      }));

    const biggestMisses = [...errors]
      .sort((a, b) => b.absError - a.absError)
      .slice(0, 10)
      .map((e) => ({
        gameweek: e.gameweek,
        playerId: e.playerId,
        projected: Math.round(e.projected * 10) / 10,
        actual: e.actual,
        error: Math.round(e.error * 10) / 10,
      }));

    const uniqueGws = new Set(errors.map((e) => e.gameweek)).size;

    return {
      engine: engineName,
      gameweeks: uniqueGws,
      sampleSize: errors.length,
      mae: Math.round(mae * 100) / 100,
      rmse: Math.round(rmse * 100) / 100,
      bias: Math.round(bias * 100) / 100,
      byGameweek,
      biggestMisses,
    };
  }

  /**
   * Get engine comparison — heuristic vs AI side by side.
   */
  async compareEngines(gameweeks = 5): Promise<{
    heuristic: AccuracyReport;
    ai: AccuracyReport;
    winner: string;
  }> {
    const [heuristic, ai] = await Promise.all([
      this.getAccuracyReport('heuristic', gameweeks),
      this.getAccuracyReport('ai', gameweeks),
    ]);

    let winner = 'tied';
    if (heuristic.mae !== null && ai.mae !== null) {
      winner = heuristic.mae < ai.mae ? 'heuristic' : 'ai';
    } else if (heuristic.mae !== null) {
      winner = 'heuristic';
    } else if (ai.mae !== null) {
      winner = 'ai';
    }

    return { heuristic, ai, winner };
  }
}

export interface AccuracyReport {
  engine: string;
  gameweeks: number;
  sampleSize: number;
  mae: number | null;              // mean absolute error
  rmse: number | null;             // root mean square error
  bias: number | null;             // positive = over-projecting
  byGameweek: Array<{
    gameweek: number;
    mae: number;
    bias: number;
    sampleSize: number;
  }>;
  biggestMisses: Array<{
    gameweek: number;
    playerId: number;
    projected: number;
    actual: number;
    error: number;
  }>;
}

export const projectionTracker = new ProjectionTracker();
