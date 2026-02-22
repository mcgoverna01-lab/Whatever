import { SQUAD_CONSTRAINTS } from '@pitch-draft/shared';
import type { Position } from '@pitch-draft/shared';
import type { ProjectionEngine } from './projection/engine.js';
import { FplClient } from './fpl-client.js';
import type {
  ProjectionContext,
  TradeEvaluation,
  TradeVerdict,
  TradeSideAnalysis,
  TradeConstraintViolation,
  BrainRoster,
} from './types.js';

interface TradeInput {
  rosterA: BrainRoster;
  rosterB: BrainRoster;
  /** Player IDs moving from A → B */
  sendPlayerIds: number[];
  /** Player IDs moving from B → A */
  receivePlayerIds: number[];
}

/**
 * Evaluate a proposed trade for fairness AND legality.
 *
 * 1. Validate FPL constraints (3-per-club, 2/5/5/3 position limits)
 * 2. Project ROS value + scarcity-adjusted value
 * 3. Compute fixture runs for traded players
 * 4. Analyze roster impact
 * 5. Return verdict, score, and detailed breakdown
 */
export function evaluateTrade(
  input: TradeInput,
  engine: ProjectionEngine,
  ctx: ProjectionContext,
): TradeEvaluation {
  // 1. Validate FPL squad constraints post-trade
  const violations = validateConstraints(input, ctx);

  // 2. Project all traded players
  const aGives = input.sendPlayerIds.map((id) => {
    const proj = engine.projectPlayer(id, ctx);
    const player = ctx.players.get(id);
    return {
      ...proj,
      scarcityAdjusted: engine.adjustForScarcity(proj, ctx),
      fixtureRun: player
        ? FplClient.averageFdr(player.teamId, ctx.fixtures, ctx.currentGameweek + 1, 5)
        : 3.0,
    };
  });

  const bGives = input.receivePlayerIds.map((id) => {
    const proj = engine.projectPlayer(id, ctx);
    const player = ctx.players.get(id);
    return {
      ...proj,
      scarcityAdjusted: engine.adjustForScarcity(proj, ctx),
      fixtureRun: player
        ? FplClient.averageFdr(player.teamId, ctx.fixtures, ctx.currentGameweek + 1, 5)
        : 3.0,
    };
  });

  const aTotalRaw = sum(aGives.map((p) => p.ros));
  const aTotalAdj = sum(aGives.map((p) => p.scarcityAdjusted));
  const bTotalRaw = sum(bGives.map((p) => p.ros));
  const bTotalAdj = sum(bGives.map((p) => p.scarcityAdjusted));

  const sideA: TradeSideAnalysis = {
    teamName: input.rosterA.teamName,
    players: aGives.map((p) => ({
      playerId: p.playerId,
      name: p.name,
      position: p.position,
      clubCode: p.clubCode,
      projectedROS: round(p.ros),
      scarcityAdjusted: round(p.scarcityAdjusted),
      fixtureRun: round(p.fixtureRun),
    })),
    totalRaw: round(aTotalRaw),
    totalAdjusted: round(aTotalAdj),
    rosterImpact: analyzeRosterImpact(
      input.rosterA, input.sendPlayerIds, input.receivePlayerIds, ctx,
    ),
  };

  const sideB: TradeSideAnalysis = {
    teamName: input.rosterB.teamName,
    players: bGives.map((p) => ({
      playerId: p.playerId,
      name: p.name,
      position: p.position,
      clubCode: p.clubCode,
      projectedROS: round(p.ros),
      scarcityAdjusted: round(p.scarcityAdjusted),
      fixtureRun: round(p.fixtureRun),
    })),
    totalRaw: round(bTotalRaw),
    totalAdjusted: round(bTotalAdj),
    rosterImpact: analyzeRosterImpact(
      input.rosterB, input.receivePlayerIds, input.sendPlayerIds, ctx,
    ),
  };

  // Fairness: A receives bTotalAdj, B receives aTotalAdj
  const aReceives = bTotalAdj;
  const bReceives = aTotalAdj;
  const totalValue = aReceives + bReceives;

  let fairnessScore = 0;
  if (totalValue > 0) {
    fairnessScore = (bReceives - aReceives) / totalValue;
  }
  fairnessScore = clamp(fairnessScore, -1, 1);

  const verdict = toVerdict(fairnessScore);
  const absDiff = Math.abs(aReceives - bReceives);
  const pctDiff = totalValue > 0 ? Math.round((absDiff / totalValue) * 200) : 0;

  let summary: string;
  if (!violations.length && verdict === 'fair') {
    summary = 'This trade is well-balanced. Both sides receive roughly equal projected value.';
  } else if (violations.length > 0) {
    summary = `This trade violates FPL squad rules: ${violations.map((v) => v.message).join('; ')}.`;
  } else {
    const favoredSide = fairnessScore < 0 ? sideA.teamName : sideB.teamName;
    const severity = Math.abs(fairnessScore) > 0.3 ? 'significantly' : 'slightly';
    summary = `This trade ${severity} favors ${favoredSide}. They receive ~${pctDiff}% more projected rest-of-season value.`;
  }

  return {
    valid: violations.length === 0,
    violations,
    verdict,
    fairnessScore: round(fairnessScore),
    summary,
    sideA,
    sideB,
  };
}

// ── FPL constraint validation ─────────────────────────────────

function validateConstraints(
  input: TradeInput,
  ctx: ProjectionContext,
): TradeConstraintViolation[] {
  const violations: TradeConstraintViolation[] = [];

  // Both sides must offer same number of players (squad stays at 15)
  if (input.sendPlayerIds.length !== input.receivePlayerIds.length) {
    violations.push({
      type: 'squad_size',
      message: `Uneven trade: side A sends ${input.sendPlayerIds.length}, side B sends ${input.receivePlayerIds.length}. Squads must stay at 15.`,
      side: 'a',
    });
  }

  // Validate post-trade constraints for both sides
  const aPost = simulateRoster(input.rosterA.playerIds, input.sendPlayerIds, input.receivePlayerIds, ctx);
  const bPost = simulateRoster(input.rosterB.playerIds, input.receivePlayerIds, input.sendPlayerIds, ctx);

  violations.push(...checkClubLimits(aPost, ctx, 'a', input.rosterA.teamName));
  violations.push(...checkClubLimits(bPost, ctx, 'b', input.rosterB.teamName));
  violations.push(...checkPositionLimits(aPost, ctx, 'a', input.rosterA.teamName));
  violations.push(...checkPositionLimits(bPost, ctx, 'b', input.rosterB.teamName));

  return violations;
}

function simulateRoster(
  current: number[],
  losing: number[],
  gaining: number[],
  _ctx: ProjectionContext,
): number[] {
  const losingSet = new Set(losing);
  return [...current.filter((id) => !losingSet.has(id)), ...gaining];
}

function checkClubLimits(
  playerIds: number[],
  ctx: ProjectionContext,
  side: 'a' | 'b',
  teamName: string,
): TradeConstraintViolation[] {
  const clubCounts = new Map<string, number>();
  for (const id of playerIds) {
    const p = ctx.players.get(id);
    if (!p) continue;
    clubCounts.set(p.clubCode, (clubCounts.get(p.clubCode) ?? 0) + 1);
  }

  const violations: TradeConstraintViolation[] = [];
  for (const [club, count] of clubCounts) {
    if (count > SQUAD_CONSTRAINTS.maxPerClub) {
      violations.push({
        type: 'club_limit',
        message: `${teamName} would have ${count} ${club} players (max ${SQUAD_CONSTRAINTS.maxPerClub})`,
        side,
      });
    }
  }
  return violations;
}

function checkPositionLimits(
  playerIds: number[],
  ctx: ProjectionContext,
  side: 'a' | 'b',
  teamName: string,
): TradeConstraintViolation[] {
  const posCounts: Record<string, number> = { GKP: 0, DEF: 0, MID: 0, FWD: 0 };
  for (const id of playerIds) {
    const p = ctx.players.get(id);
    if (p && p.position in posCounts) {
      posCounts[p.position]++;
    }
  }

  const violations: TradeConstraintViolation[] = [];
  for (const [pos, limits] of Object.entries(SQUAD_CONSTRAINTS.positions)) {
    const count = posCounts[pos] ?? 0;
    if (count > limits.max) {
      violations.push({
        type: 'position_limit',
        message: `${teamName} would have ${count} ${pos} (max ${limits.max})`,
        side,
      });
    }
    if (count < limits.min) {
      violations.push({
        type: 'position_limit',
        message: `${teamName} would have ${count} ${pos} (min ${limits.min})`,
        side,
      });
    }
  }
  return violations;
}

// ── Helpers ───────────────────────────────────────────────────

function analyzeRosterImpact(
  roster: BrainRoster,
  losingIds: number[],
  gainingIds: number[],
  ctx: ProjectionContext,
): string {
  const positionsLost = losingIds
    .map((id) => ctx.players.get(id)?.position)
    .filter(Boolean) as Position[];
  const positionsGained = gainingIds
    .map((id) => ctx.players.get(id)?.position)
    .filter(Boolean) as Position[];

  const parts: string[] = [];

  if (positionsLost.length > 0) {
    const uniquePos = [...new Set(positionsLost)];
    parts.push(`Sends ${uniquePos.join('/')} talent`);
  }
  if (positionsGained.length > 0) {
    const uniquePos = [...new Set(positionsGained)];
    parts.push(`gains ${uniquePos.join('/')} depth`);
  }

  // Check club concentration change
  const posDelta = new Map<string, number>();
  for (const id of losingIds) {
    const pos = ctx.players.get(id)?.position ?? 'MID';
    posDelta.set(pos, (posDelta.get(pos) ?? 0) - 1);
  }
  for (const id of gainingIds) {
    const pos = ctx.players.get(id)?.position ?? 'MID';
    posDelta.set(pos, (posDelta.get(pos) ?? 0) + 1);
  }

  const thinPositions = [...posDelta.entries()].filter(([, d]) => d < 0).map(([pos]) => pos);
  if (thinPositions.length > 0) {
    parts.push(`thins ${thinPositions.join(', ')} depth`);
  }

  return parts.join('; ') || 'Minimal roster impact';
}

function toVerdict(score: number): TradeVerdict {
  const abs = Math.abs(score);
  const side = score < 0 ? 'a' : 'b';
  if (abs < 0.08) return 'fair';
  if (abs < 0.20) return `slightly_favors_${side}` as TradeVerdict;
  if (abs < 0.35) return `favors_${side}` as TradeVerdict;
  return `heavily_favors_${side}` as TradeVerdict;
}

function sum(nums: number[]): number {
  return nums.reduce((a, b) => a + b, 0);
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
