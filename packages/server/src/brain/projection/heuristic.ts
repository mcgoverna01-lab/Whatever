import type { Position } from '@pitch-draft/shared';
import { ProjectionEngine } from './engine.js';
import { FplClient } from '../fpl-client.js';
import type { PlayerProjection, ProjectionContext, FplPlayer } from '../types.js';

const FDR_MULTIPLIER: Record<number, number> = {
  1: 1.20,
  2: 1.10,
  3: 1.00,
  4: 0.90,
  5: 0.80,
};

/**
 * Heuristic projection engine — fast, no external AI calls.
 *
 * Per-gameweek projections using FPL's own data:
 * 1. Base PPG blended from recent form + season average
 * 2. Fixture difficulty adjustment (FDR 1–5)
 * 3. Blank GW → 0 pts, double GW → 2× pts
 * 4. Injury risk via chance_of_playing
 * 5. Regression to position mean
 */
export class HeuristicEngine extends ProjectionEngine {
  readonly name = 'heuristic';

  constructor(
    private opts: {
      formWeight?: number;
      regressionWeight?: number;
    } = {},
  ) {
    super();
  }

  private get formW(): number { return this.opts.formWeight ?? 0.55; }
  private get regW(): number { return this.opts.regressionWeight ?? 0.15; }

  projectPlayer(playerId: number, ctx: ProjectionContext): PlayerProjection {
    const player = ctx.players.get(playerId);
    if (!player) {
      return { playerId, name: `Unknown (${playerId})`, position: 'MID', clubCode: '???', ros: 0, ppg: 0, confidence: 0 };
    }

    const remainingGws = ctx.totalGameweeks - ctx.currentGameweek;
    if (remainingGws <= 0) {
      return { playerId: player.id, name: player.webName, position: player.position, clubCode: player.clubCode, ros: 0, ppg: 0, confidence: 0 };
    }

    const basePpg = this.blendedPpg(player, ctx);
    const baseline = this.positionBaseline(player.position);
    const regressedPpg = basePpg * (1 - this.regW) + baseline * this.regW;

    const teamFixtures = FplClient.teamFixturesInRange(
      player.teamId, ctx.fixtures,
      ctx.currentGameweek + 1, ctx.totalGameweeks,
    );

    let rosTotal = 0;
    const weekly: NonNullable<PlayerProjection['weeklyBreakdown']> = [];

    for (let gw = ctx.currentGameweek + 1; gw <= ctx.totalGameweeks; gw++) {
      const gwFixtures = teamFixtures.get(gw) ?? [];
      const fixtureCount = gwFixtures.length;

      if (fixtureCount === 0) {
        weekly.push({ gameweek: gw, projected: 0, fixtureCount: 0, avgFdr: 0 });
        continue;
      }

      const avgFdr = gwFixtures.reduce((s, f) => s + f.difficulty, 0) / fixtureCount;
      const fdrMult = FDR_MULTIPLIER[Math.round(avgFdr)] ?? 1.0;

      let injuryMult = 1.0;
      if (gw === ctx.currentGameweek + 1) {
        injuryMult = this.injuryMultiplier(player);
      }

      const gwProjected = regressedPpg * fixtureCount * fdrMult * injuryMult;
      rosTotal += gwProjected;
      weekly.push({ gameweek: gw, projected: round(gwProjected), fixtureCount, avgFdr: round(avgFdr) });
    }

    const effectiveGames = weekly.reduce((s, w) => s + w.fixtureCount, 0);
    const effectivePpg = effectiveGames > 0 ? rosTotal / effectiveGames : 0;

    return {
      playerId: player.id,
      name: player.webName,
      position: player.position,
      clubCode: player.clubCode,
      ros: round(rosTotal),
      ppg: round(effectivePpg),
      confidence: this.confidence(player, ctx),
      weeklyBreakdown: weekly,
    };
  }

  getPositionalScarcity(position: Position, _ctx: ProjectionContext): number {
    // FPL Draft: 2 GKP, 5 DEF, 5 MID, 3 FWD.
    // FWD most scarce (fewest slots, fewer elite options).
    const scarcity: Record<string, number> = { GKP: 0.6, DEF: 1.0, MID: 1.15, FWD: 1.35 };
    return scarcity[position] ?? 1.0;
  }

  // ── Internals ───────────────────────────────────────────────

  private blendedPpg(player: FplPlayer, ctx: ProjectionContext): number {
    const seasonPpg = player.ppg;
    let recentPpg = player.form;

    const recentEntries = ctx.recentStats.get(player.id) ?? [];
    if (recentEntries.length >= 2) {
      const sorted = [...recentEntries].sort((a, b) => b.gameweek - a.gameweek);
      let wSum = 0, wTotal = 0;
      for (let i = 0; i < sorted.length; i++) {
        const w = Math.pow(0.82, i);
        wSum += sorted[i].totalPoints * w;
        wTotal += w;
      }
      recentPpg = wSum / wTotal;
    }

    return recentPpg * this.formW + seasonPpg * (1 - this.formW);
  }

  private injuryMultiplier(player: FplPlayer): number {
    if (player.status === 'i' || player.status === 's' || player.status === 'u') {
      const chance = player.chanceOfPlayingNextRound;
      if (chance === null || chance === 0) return 0;
      return chance / 100;
    }
    if (player.status === 'd') {
      return (player.chanceOfPlayingNextRound ?? 50) / 100;
    }
    return 1.0;
  }

  private confidence(player: FplPlayer, ctx: ProjectionContext): number {
    let c = 0.4;
    c += Math.min((player.minutes / 90) * 0.02, 0.3);
    c += Math.min((ctx.recentStats.get(player.id)?.length ?? 0) * 0.03, 0.15);
    if (player.status !== 'a') c -= 0.1;
    return round(Math.max(0.1, Math.min(c, 0.90)));
  }

  private positionBaseline(position: Position): number {
    const baselines: Record<string, number> = { GKP: 3.8, DEF: 4.0, MID: 4.5, FWD: 4.0 };
    return baselines[position] ?? 3.5;
  }
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
