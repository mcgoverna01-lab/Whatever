import type { ProjectionEngine } from './projection/engine.js';
import type {
  ProjectionContext,
  FaabAdvice,
  FaabBidSuggestion,
  SleeperRoster,
  WaiverRecommendation,
} from './types.js';
import { recommendWaivers } from './waiver-recommender.js';

interface FaabInput {
  rosterId: number;
  /** Max bid suggestions to return */
  limit?: number;
}

/**
 * FAAB budget advisor.
 *
 * Answers three questions:
 * 1. How's my budget pacing? (Over/under-spending vs. where we are in the season)
 * 2. What should I bid on this week?
 * 3. How much should I bid for each target?
 *
 * Bid sizing is based on:
 * - Net improvement the player brings to your roster
 * - Positional scarcity (scarce positions are bid up by other managers)
 * - Where we are in the season (late-season adds are cheaper)
 * - Budget remaining (can't recommend $20 if you have $8 left)
 */
export function adviseFaab(
  input: FaabInput,
  rosters: SleeperRoster[],
  engine: ProjectionEngine,
  ctx: ProjectionContext,
): FaabAdvice {
  const limit = input.limit ?? 5;
  const roster = rosters.find((r) => r.roster_id === input.rosterId);
  if (!roster) {
    throw Object.assign(new Error('Roster not found'), {
      status: 400,
      code: 'ROSTER_NOT_FOUND',
    });
  }

  // Budget info
  const totalBudget = ctx.league.settings.waiver_budget || 100;
  const spent = roster.settings.waiver_budget_used ?? 0;
  const remaining = totalBudget - spent;
  const weeksPassed = Math.max(ctx.week - 1, 0);
  const weeksRemaining = Math.max(ctx.totalWeeks - ctx.week, 1);

  // Pacing
  const idealSpentPct = weeksPassed / ctx.totalWeeks;
  const actualSpentPct = spent / totalBudget;
  const weeklyBudget = remaining / weeksRemaining;

  let status: FaabAdvice['pacing']['status'];
  let recommendation: string;

  if (actualSpentPct < idealSpentPct - 0.15) {
    status = 'under_spending';
    recommendation = `You've only spent $${spent} of $${totalBudget} through week ${ctx.week}. ` +
      `You can afford to be more aggressive — unspent FAAB at season's end is wasted value. ` +
      `Target ~$${Math.round(weeklyBudget)} per week.`;
  } else if (actualSpentPct > idealSpentPct + 0.15) {
    status = 'over_spending';
    recommendation = `You've spent $${spent} of $${totalBudget} with ${weeksRemaining} weeks left. ` +
      `Tighten up — only bid on clear starters. Save $${Math.round(remaining * 0.2)} as a reserve ` +
      `for late-season emergencies.`;
  } else {
    status = 'on_track';
    recommendation = `Budget pacing is healthy. $${remaining} remaining over ${weeksRemaining} weeks ` +
      `(~$${Math.round(weeklyBudget)}/week). Keep a $${Math.round(remaining * 0.15)} reserve for must-haves.`;
  }

  // Use the waiver recommender to find targets
  const waiverAnalysis = recommendWaivers(
    { rosterId: input.rosterId, limit: limit + 5 },
    rosters,
    engine,
    ctx,
  );

  // Convert recommendations into bid suggestions
  const bids: FaabBidSuggestion[] = waiverAnalysis.recommendations
    .slice(0, limit)
    .map((rec, i) => toBidSuggestion(rec, i, remaining, weeksRemaining, engine, ctx));

  return {
    budget: {
      total: totalBudget,
      spent,
      remaining,
      weeksPassed,
      weeksRemaining,
    },
    pacing: {
      weeklyBudget: round(weeklyBudget),
      status,
      recommendation,
    },
    bids,
  };
}

// ── Internals ─────────────────────────────────────────────────

function toBidSuggestion(
  rec: WaiverRecommendation,
  rank: number,
  budgetRemaining: number,
  weeksRemaining: number,
  engine: ProjectionEngine,
  ctx: ProjectionContext,
): FaabBidSuggestion {
  const scarcity = engine.getPositionalScarcity(rec.player.position, ctx);

  // Base bid: proportional to net improvement
  const netGainNormalized = Math.min(rec.netGain / 50, 1); // 50 ROS pts = max signal
  const seasonUrgency = 1 + (1 - weeksRemaining / ctx.totalWeeks) * 0.3; // bid more late

  const basePct = netGainNormalized * scarcity * seasonUrgency;
  const maxBid = Math.round(budgetRemaining * Math.min(basePct * 0.3, 0.5));
  const minBid = Math.max(1, Math.round(maxBid * 0.5));
  const recommended = Math.round((minBid + maxBid) / 2);

  // Priority classification
  let priority: FaabBidSuggestion['priority'];
  if (rec.netGain > 40) {
    priority = 'must_bid';
  } else if (rec.netGain > 20) {
    priority = 'strong_add';
  } else if (rec.netGain > 8) {
    priority = 'depth_add';
  } else {
    priority = 'speculative';
  }

  // Confidence decreases for lower-ranked targets
  const confidence = Math.max(0.3, 0.85 - rank * 0.1);

  const reason = buildBidReason(rec, recommended, priority, budgetRemaining, weeksRemaining);

  return {
    player: rec.player,
    suggestedBid: {
      min: Math.min(minBid, budgetRemaining),
      max: Math.min(maxBid, budgetRemaining),
      recommended: Math.min(recommended, budgetRemaining),
    },
    confidence: round(confidence),
    reason,
    priority,
  };
}

function buildBidReason(
  rec: WaiverRecommendation,
  recommended: number,
  priority: string,
  remaining: number,
  weeksRemaining: number,
): string {
  const parts: string[] = [];

  if (priority === 'must_bid') {
    parts.push(`High-impact ${rec.player.position} add.`);
  } else if (priority === 'strong_add') {
    parts.push(`Solid ${rec.player.position} upgrade.`);
  } else if (priority === 'depth_add') {
    parts.push(`Bench depth improvement.`);
  } else {
    parts.push(`Low-cost speculative add.`);
  }

  if (rec.improvementOver) {
    parts.push(
      `Projects ${round(rec.netGain)} more ROS pts than ${rec.improvementOver.name}.`,
    );
  }

  parts.push(`$${recommended} is ~${Math.round((recommended / remaining) * 100)}% of remaining budget.`);

  return parts.join(' ');
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
