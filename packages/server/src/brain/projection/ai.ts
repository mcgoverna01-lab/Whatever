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
 * AI-powered projection engine using Claude for context-aware reasoning.
 *
 * Combines a heuristic baseline with LLM insight:
 * 1. Compute heuristic projection first (fixture-aware, form-weighted)
 * 2. Build rich context prompt (stats, injuries, fixtures, form trends)
 * 3. Call Claude for a reasoned adjustment + reasoning
 * 4. Blend LLM suggestion with heuristic baseline for stability
 *
 * Falls back to pure heuristic if the API call fails.
 *
 * Enable via: PROJECTION_ENGINE=ai + AI_API_KEY=sk-ant-...
 */
export class AiEngine extends ProjectionEngine {
  readonly name = 'ai';

  constructor(
    private config: {
      provider: string;
      model: string;
      apiKey: string;
    },
  ) {
    super();
  }

  projectPlayer(playerId: number, ctx: ProjectionContext): PlayerProjection {
    if (!this.config.apiKey) {
      throw Object.assign(
        new Error('AI engine requires an API key. Set AI_API_KEY or use PROJECTION_ENGINE=heuristic.'),
        { status: 400, code: 'AI_NOT_CONFIGURED' },
      );
    }

    // Start with heuristic baseline — guarantees a result even if AI fails
    const baseline = this.heuristicBaseline(playerId, ctx);

    // Fire off AI enhancement asynchronously, but return baseline synchronously
    // The engine interface is synchronous, so we cache AI results and serve
    // them on the *next* call. First call always returns heuristic.
    const cached = this.aiCache.get(playerId);
    if (cached && cached.gameweek === ctx.currentGameweek) {
      return this.blendProjection(baseline, cached.adjustment);
    }

    // Trigger async AI call (non-blocking)
    this.fetchAiAdjustment(playerId, baseline, ctx).catch(() => {
      // Swallow — heuristic is the fallback
    });

    return baseline;
  }

  getPositionalScarcity(position: Position, _ctx: ProjectionContext): number {
    const scarcity: Record<string, number> = { GKP: 0.6, DEF: 1.0, MID: 1.15, FWD: 1.35 };
    return scarcity[position] ?? 1.0;
  }

  // ── AI cache ─────────────────────────────────────────────────

  private aiCache = new Map<number, {
    gameweek: number;
    adjustment: AiAdjustment;
  }>();

  private pendingRequests = new Set<number>();

  // ── AI API call ──────────────────────────────────────────────

  private async fetchAiAdjustment(
    playerId: number,
    baseline: PlayerProjection,
    ctx: ProjectionContext,
  ): Promise<void> {
    // Deduplicate in-flight requests
    if (this.pendingRequests.has(playerId)) return;
    this.pendingRequests.add(playerId);

    try {
      const player = ctx.players.get(playerId);
      if (!player) return;

      const prompt = this.buildPrompt(player, baseline, ctx);
      const adjustment = await this.callClaude(prompt);

      this.aiCache.set(playerId, {
        gameweek: ctx.currentGameweek,
        adjustment,
      });
    } finally {
      this.pendingRequests.delete(playerId);
    }
  }

  private buildPrompt(
    player: FplPlayer,
    baseline: PlayerProjection,
    ctx: ProjectionContext,
  ): string {
    const remainingGws = ctx.totalGameweeks - ctx.currentGameweek;
    const teamFixtures = FplClient.teamFixturesInRange(
      player.teamId, ctx.fixtures,
      ctx.currentGameweek + 1, Math.min(ctx.currentGameweek + 6, ctx.totalGameweeks),
    );

    // Build fixture string
    const fixtureList: string[] = [];
    for (const [gw, fixtures] of teamFixtures) {
      if (fixtures.length === 0) {
        fixtureList.push(`GW${gw}: BLANK`);
      } else {
        const opponents = fixtures.map((f) => {
          const club = ctx.clubs.get(f.opponentId);
          return `${f.isHome ? 'H' : 'A'} vs ${club?.shortName ?? '???'} (FDR ${f.difficulty})`;
        });
        fixtureList.push(`GW${gw}: ${opponents.join(', ')}`);
      }
    }

    // Recent form stats
    const recentEntries = ctx.recentStats.get(player.id) ?? [];
    const recentStr = recentEntries
      .sort((a, b) => b.gameweek - a.gameweek)
      .slice(0, 5)
      .map((e) => `GW${e.gameweek}: ${e.totalPoints}pts (${e.minutes}min)`)
      .join(', ');

    return `You are an FPL (Fantasy Premier League) analyst. Evaluate this player's rest-of-season projection.

PLAYER: ${player.webName} (${player.position}, ${player.clubCode})
SEASON STATS: ${player.totalPoints} total pts, ${player.ppg} PPG, Form ${player.form}, ICT ${player.ictIndex}
MINUTES: ${player.minutes}
STATUS: ${player.status}${player.news ? ` — ${player.news}` : ''}
CHANCE NEXT GW: ${player.chanceOfPlayingNextRound ?? 'unknown'}%

RECENT FORM: ${recentStr || 'No recent data'}

UPCOMING FIXTURES (next 6 GWs):
${fixtureList.join('\n')}

REMAINING GWs: ${remainingGws}

HEURISTIC BASELINE: ${baseline.ros.toFixed(1)} ROS pts, ${baseline.ppg.toFixed(2)} PPG

Respond ONLY with valid JSON in this exact format:
{"ppg_adjustment": <number between -1.5 and +1.5>, "confidence": <0.0 to 1.0>, "reasoning": "<1 sentence>"}

ppg_adjustment: how much to shift the baseline PPG (positive = bullish, negative = bearish).
Consider: injury risk, fixture difficulty patterns, team form, positional role changes, transfer rumors.`;
  }

  private async callClaude(prompt: string): Promise<AiAdjustment> {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.config.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.config.model,
        max_tokens: 200,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) {
      throw new Error(`Claude API error: ${res.status}`);
    }

    const data = await res.json() as {
      content: Array<{ type: string; text?: string }>;
    };

    const text = data.content.find((c) => c.type === 'text')?.text ?? '';
    const jsonMatch = text.match(/\{[\s\S]*?\}/);
    if (!jsonMatch) {
      throw new Error('No JSON in Claude response');
    }

    const parsed = JSON.parse(jsonMatch[0]) as {
      ppg_adjustment: number;
      confidence: number;
      reasoning: string;
    };

    return {
      ppgAdjustment: clamp(parsed.ppg_adjustment, -1.5, 1.5),
      confidence: clamp(parsed.confidence, 0, 1),
      reasoning: parsed.reasoning,
    };
  }

  // ── Heuristic baseline (mirrors HeuristicEngine logic) ─────

  private heuristicBaseline(playerId: number, ctx: ProjectionContext): PlayerProjection {
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
    const regressedPpg = basePpg * 0.85 + baseline * 0.15;

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
      confidence: round(Math.max(0.1, Math.min(this.baseConfidence(player, ctx), 0.90))),
      weeklyBreakdown: weekly,
    };
  }

  private blendProjection(baseline: PlayerProjection, adj: AiAdjustment): PlayerProjection {
    const aiWeight = adj.confidence * 0.4; // AI never dominates — max 40% influence
    const adjustedPpg = baseline.ppg + adj.ppgAdjustment * aiWeight;

    const remainingFixtures = baseline.weeklyBreakdown?.reduce((s, w) => s + w.fixtureCount, 0) ?? 0;
    const adjustedRos = adjustedPpg * remainingFixtures;

    return {
      ...baseline,
      ppg: round(adjustedPpg),
      ros: round(adjustedRos),
      confidence: round(Math.min(baseline.confidence + adj.confidence * 0.1, 0.95)),
    };
  }

  // ── Shared internals ──────────────────────────────────────────

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

    return recentPpg * 0.55 + seasonPpg * 0.45;
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

  private baseConfidence(player: FplPlayer, ctx: ProjectionContext): number {
    let c = 0.4;
    c += Math.min((player.minutes / 90) * 0.02, 0.3);
    c += Math.min((ctx.recentStats.get(player.id)?.length ?? 0) * 0.03, 0.15);
    if (player.status !== 'a') c -= 0.1;
    return c;
  }

  private positionBaseline(position: Position): number {
    const baselines: Record<string, number> = { GKP: 3.8, DEF: 4.0, MID: 4.5, FWD: 4.0 };
    return baselines[position] ?? 3.5;
  }
}

// ── Helpers ──────────────────────────────────────────────────

interface AiAdjustment {
  ppgAdjustment: number;
  confidence: number;
  reasoning: string;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
