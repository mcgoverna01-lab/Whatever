import { ProjectionEngine } from './engine.js';
import { SleeperClient } from '../sleeper-client.js';
import type { PlayerProjection, ProjectionContext } from '../types.js';

/**
 * Heuristic projection engine — simple math, no external AI calls.
 *
 * Algorithm:
 * 1. Gather the player's weekly fantasy points (using league scoring settings).
 * 2. Compute a recency-weighted PPG (recent weeks count more).
 * 3. Regress toward the position baseline to smooth variance.
 * 4. Multiply by remaining weeks for ROS total.
 *
 * Tuning knobs are in the constructor so they're easy to tweak or A/B test.
 */
export class HeuristicEngine extends ProjectionEngine {
  readonly name = 'heuristic';

  constructor(
    private opts: {
      /** Exponential decay per older week (0.85 = 15% less weight each older week). */
      decayFactor?: number;
      /** How much to pull toward position average (0 = trust raw data, 1 = all baseline). */
      regressionWeight?: number;
    } = {},
  ) {
    super();
  }

  private get decay(): number {
    return this.opts.decayFactor ?? 0.85;
  }

  private get regression(): number {
    return this.opts.regressionWeight ?? 0.20;
  }

  projectPlayer(playerId: string, ctx: ProjectionContext): PlayerProjection {
    const player = ctx.players[playerId];
    const name = player ? `${player.first_name} ${player.last_name}` : playerId;
    const position = player?.position ?? 'UNKNOWN';
    const team = player?.team ?? null;

    const remainingWeeks = Math.max(ctx.totalWeeks - ctx.week, 0);

    // Gather weekly fantasy points for this player
    const weeklyStats = ctx.playerStats[playerId];
    if (!weeklyStats || Object.keys(weeklyStats).length === 0) {
      // No stats — fall back to position baseline
      const baseline = this.positionBaseline(position);
      return {
        playerId,
        name,
        position,
        team,
        ros: baseline * remainingWeeks,
        ppg: baseline,
        confidence: 0.25,
      };
    }

    // Calculate fantasy points for each week using league scoring
    const weekEntries = Object.entries(weeklyStats)
      .map(([weekStr, stats]) => ({
        week: parseInt(weekStr, 10),
        pts: SleeperClient.calculatePoints(stats, ctx.league.scoring_settings),
      }))
      .filter((w) => w.pts > 0 || weeklyStats[w.week]?.gp > 0) // played that week
      .sort((a, b) => b.week - a.week); // most recent first

    if (weekEntries.length === 0) {
      const baseline = this.positionBaseline(position);
      return {
        playerId,
        name,
        position,
        team,
        ros: baseline * remainingWeeks,
        ppg: baseline,
        confidence: 0.3,
      };
    }

    // Recency-weighted average
    let weightedSum = 0;
    let totalWeight = 0;
    for (let i = 0; i < weekEntries.length; i++) {
      const weight = Math.pow(this.decay, i);
      weightedSum += weekEntries[i].pts * weight;
      totalWeight += weight;
    }
    const rawPpg = weightedSum / totalWeight;

    // Regress toward position mean
    const baseline = this.positionBaseline(position);
    const ppg = rawPpg * (1 - this.regression) + baseline * this.regression;

    // Confidence scales with sample size (caps at 0.85)
    const confidence = Math.min(0.40 + weekEntries.length * 0.035, 0.85);

    return {
      playerId,
      name,
      position,
      team,
      ros: Math.round(ppg * remainingWeeks * 100) / 100,
      ppg: Math.round(ppg * 100) / 100,
      confidence: Math.round(confidence * 100) / 100,
    };
  }

  getPositionalScarcity(position: string, _ctx: ProjectionContext): number {
    // Multipliers reflect typical 12-team NFL fantasy leagues.
    // TE is most scarce (top-3 TEs are dramatically better than replacement).
    // QB is often over-drafted but replacement level is decent → 1.0.
    const scarcity: Record<string, number> = {
      QB: 1.0,
      RB: 1.25,
      WR: 1.1,
      TE: 1.4,
      K: 0.4,
      DEF: 0.4,
    };
    return scarcity[position] ?? 1.0;
  }

  /** Average PPG for a replacement-level player at this position. */
  private positionBaseline(position: string): number {
    const baselines: Record<string, number> = {
      QB: 16,
      RB: 10,
      WR: 10,
      TE: 7,
      K: 7,
      DEF: 6,
    };
    return baselines[position] ?? 5;
  }
}
