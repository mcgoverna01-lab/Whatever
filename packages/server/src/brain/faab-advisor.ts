import type { Position } from '@pitch-draft/shared';
import type { ProjectionEngine } from './projection/engine.js';
import type {
  ProjectionContext,
  FaabAdvice,
  FaabBidSuggestion,
  BrainRoster,
  WaiverRecommendation,
} from './types.js';
import { recommendWaivers } from './waiver-recommender.js';

interface FaabInput {
  roster: BrainRoster;
  allRosters: BrainRoster[];
  totalBudget: number;
  limit?: number;
}

/**
 * FAAB budget advisor with competitive awareness.
 *
 * Beyond basic pacing, this analyzes ALL teams' rosters to estimate
 * how many managers will bid on each target. More competition = higher bid.
 *
 * 1. Budget pacing: are you over/under-spending?
 * 2. Competitive analysis: who else needs this position?
 * 3. Bid sizing: improvement × scarcity × competition × urgency
 */
export function adviseFaab(
  input: FaabInput,
  engine: ProjectionEngine,
  ctx: ProjectionContext,
): FaabAdvice {
  const limit = input.limit ?? 5;
  const { roster, totalBudget } = input;
  const spent = totalBudget - roster.faabRemaining;
  const remaining = roster.faabRemaining;
  const gwPassed = Math.max(ctx.currentGameweek - 1, 0);
  const gwRemaining = Math.max(ctx.totalGameweeks - ctx.currentGameweek, 1);

  // Pacing
  const idealSpentPct = gwPassed / ctx.totalGameweeks;
  const actualSpentPct = totalBudget > 0 ? spent / totalBudget : 0;
  const weeklyBudget = remaining / gwRemaining;

  let status: FaabAdvice['pacing']['status'];
  let recommendation: string;

  if (actualSpentPct < idealSpentPct - 0.15) {
    status = 'under_spending';
    recommendation = `Only ${spent} of ${totalBudget} FAAB spent through GW${ctx.currentGameweek}. ` +
      `Be more aggressive — unspent FAAB at season's end is wasted. Target ~${Math.round(weeklyBudget)}/week.`;
  } else if (actualSpentPct > idealSpentPct + 0.15) {
    status = 'over_spending';
    recommendation = `${spent} of ${totalBudget} FAAB spent with ${gwRemaining} GWs left. ` +
      `Tighten bids — only chase clear starters. Reserve ${Math.round(remaining * 0.2)} for emergencies.`;
  } else {
    status = 'on_track';
    recommendation = `Pacing is healthy. ${remaining} FAAB over ${gwRemaining} GWs ` +
      `(~${Math.round(weeklyBudget)}/week). Keep ~${Math.round(remaining * 0.15)} in reserve.`;
  }

  // Get waiver recommendations
  const waiverAnalysis = recommendWaivers(
    { roster, allRosters: input.allRosters, limit: limit + 5 },
    engine,
    ctx,
  );

  // Competitive analysis: count how many teams need each position
  const positionDemand = analyzeLeagueDemand(input.allRosters, engine, ctx);

  // Convert to bid suggestions
  const bids: FaabBidSuggestion[] = waiverAnalysis.recommendations
    .slice(0, limit)
    .map((rec, i) => toBidSuggestion(
      rec, i, remaining, gwRemaining, positionDemand, engine, ctx,
    ));

  return {
    budget: {
      total: totalBudget,
      spent,
      remaining,
      gameweeksPassed: gwPassed,
      gameweeksRemaining: gwRemaining,
    },
    pacing: {
      weeklyBudget: round(weeklyBudget),
      status,
      recommendation,
    },
    bids,
  };
}

// ── Competitive analysis ──────────────────────────────────────

/**
 * For each position, count how many teams are "thin" (at or below minimum).
 * More teams thin at a position = more competition for free agents at that position.
 */
function analyzeLeagueDemand(
  allRosters: BrainRoster[],
  engine: ProjectionEngine,
  ctx: ProjectionContext,
): Map<Position, number> {
  const demand = new Map<Position, number>();
  const positions: Position[] = ['GKP', 'DEF', 'MID', 'FWD'];

  for (const pos of positions) {
    let teamsNeedingPos = 0;

    for (const roster of allRosters) {
      const projections = roster.playerIds
        .map((id) => engine.projectPlayer(id, ctx))
        .filter((p) => p.position === pos);

      const sorted = [...projections].sort((a, b) => b.ppg - a.ppg);
      const baseline = posThreshold(pos);

      // A team "needs" this position if their worst rostered player
      // at that position is significantly below replacement level
      const weakest = sorted[sorted.length - 1];
      if (!weakest || weakest.ppg < baseline * 0.6) {
        teamsNeedingPos++;
      }
    }

    demand.set(pos, teamsNeedingPos);
  }

  return demand;
}

function toBidSuggestion(
  rec: WaiverRecommendation,
  rank: number,
  budgetRemaining: number,
  gwRemaining: number,
  positionDemand: Map<Position, number>,
  engine: ProjectionEngine,
  ctx: ProjectionContext,
): FaabBidSuggestion {
  const scarcity = engine.getPositionalScarcity(rec.player.position, ctx);
  const competition = positionDemand.get(rec.player.position) ?? 0;

  // Base bid sizing
  const netGainNormalized = Math.min(rec.netGain / 30, 1); // 30 ROS pts = max signal (FPL scale)
  const seasonUrgency = 1 + (1 - gwRemaining / ctx.totalGameweeks) * 0.3;
  const competitionMult = 1 + competition * 0.15; // more competitors = bid higher

  const basePct = netGainNormalized * scarcity * seasonUrgency * competitionMult;
  const maxBid = Math.max(1, Math.round(budgetRemaining * Math.min(basePct * 0.25, 0.45)));
  const minBid = Math.max(1, Math.round(maxBid * 0.5));
  const recommended = Math.round((minBid + maxBid) / 2);

  // Priority classification (FPL-calibrated: lower ROS totals than NFL)
  let priority: FaabBidSuggestion['priority'];
  if (rec.netGain > 25) priority = 'must_bid';
  else if (rec.netGain > 12) priority = 'strong_add';
  else if (rec.netGain > 5) priority = 'depth_add';
  else priority = 'speculative';

  const confidence = round(Math.max(0.3, 0.85 - rank * 0.1));
  const reason = buildReason(rec, recommended, priority, competition, budgetRemaining);

  return {
    player: {
      playerId: rec.player.playerId,
      name: rec.player.name,
      position: rec.player.position,
      clubCode: rec.player.clubCode,
      form: rec.player.form,
    },
    suggestedBid: {
      min: Math.min(minBid, budgetRemaining),
      max: Math.min(maxBid, budgetRemaining),
      recommended: Math.min(recommended, budgetRemaining),
    },
    confidence,
    reason,
    priority,
    estimatedCompetition: competition,
  };
}

function buildReason(
  rec: WaiverRecommendation,
  recommended: number,
  priority: string,
  competition: number,
  remaining: number,
): string {
  const parts: string[] = [];

  if (priority === 'must_bid') parts.push(`High-impact ${rec.player.position} add.`);
  else if (priority === 'strong_add') parts.push(`Solid ${rec.player.position} upgrade.`);
  else if (priority === 'depth_add') parts.push(`Bench depth improvement.`);
  else parts.push(`Low-cost speculative add.`);

  if (rec.improvementOver) {
    parts.push(`Projects ${round(rec.netGain)} more ROS pts than ${rec.improvementOver.name}.`);
  }

  if (competition >= 3) {
    parts.push(`High competition — ${competition} teams need ${rec.player.position}.`);
  } else if (competition >= 2) {
    parts.push(`Moderate competition from ${competition} other teams.`);
  }

  if (rec.player.fixtureRun < 2.5) {
    parts.push('Favorable upcoming fixtures.');
  }

  parts.push(`${recommended} FAAB = ~${remaining > 0 ? Math.round((recommended / remaining) * 100) : 0}% of budget.`);

  return parts.join(' ');
}

function posThreshold(pos: Position): number {
  const t: Record<string, number> = { GKP: 3.5, DEF: 3.8, MID: 4.2, FWD: 3.8 };
  return t[pos] ?? 3.5;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
