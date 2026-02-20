import type { ProjectionEngine } from './projection/engine.js';
import type {
  ProjectionContext,
  TradeEvaluation,
  TradeVerdict,
  TradeSideAnalysis,
  SleeperRoster,
} from './types.js';

interface TradeInput {
  /** Roster ID of side A */
  rosterIdA: number;
  /** Roster ID of side B */
  rosterIdB: number;
  /** Player IDs moving from A → B */
  sendPlayerIds: string[];
  /** Player IDs moving from B → A */
  receivePlayerIds: string[];
}

/**
 * Evaluate a proposed trade for fairness.
 *
 * How it works:
 * 1. Project rest-of-season value for every player in the trade.
 * 2. Apply positional scarcity multipliers (TE > RB > WR > QB >> K/DEF).
 * 3. Analyze roster impact: what does each side look like after the trade?
 * 4. Compute a fairness score and produce a human-readable verdict.
 */
export function evaluateTrade(
  input: TradeInput,
  rosters: SleeperRoster[],
  engine: ProjectionEngine,
  ctx: ProjectionContext,
): TradeEvaluation {
  const rosterA = rosters.find((r) => r.roster_id === input.rosterIdA);
  const rosterB = rosters.find((r) => r.roster_id === input.rosterIdB);

  if (!rosterA || !rosterB) {
    throw Object.assign(new Error('Roster not found'), {
      status: 400,
      code: 'ROSTER_NOT_FOUND',
    });
  }

  // Project players that A is sending (B receives these)
  const aGivesProjections = input.sendPlayerIds.map((id) => {
    const proj = engine.projectPlayer(id, ctx);
    return {
      ...proj,
      scarcityAdjusted: engine.adjustForScarcity(proj, ctx),
    };
  });

  // Project players that B is sending (A receives these)
  const bGivesProjections = input.receivePlayerIds.map((id) => {
    const proj = engine.projectPlayer(id, ctx);
    return {
      ...proj,
      scarcityAdjusted: engine.adjustForScarcity(proj, ctx),
    };
  });

  const aTotalRaw = sum(aGivesProjections.map((p) => p.ros));
  const aTotalAdj = sum(aGivesProjections.map((p) => p.scarcityAdjusted));
  const bTotalRaw = sum(bGivesProjections.map((p) => p.ros));
  const bTotalAdj = sum(bGivesProjections.map((p) => p.scarcityAdjusted));

  // Side A analysis (what A is sending away)
  const sideA: TradeSideAnalysis = {
    teamName: `Roster ${input.rosterIdA}`,
    players: aGivesProjections.map((p) => ({
      playerId: p.playerId,
      name: p.name,
      position: p.position,
      projectedROS: round(p.ros),
      scarcityAdjusted: round(p.scarcityAdjusted),
    })),
    totalRaw: round(aTotalRaw),
    totalAdjusted: round(aTotalAdj),
    rosterImpact: analyzeRosterImpact(rosterA, input.sendPlayerIds, input.receivePlayerIds, engine, ctx),
  };

  // Side B analysis (what B is sending away)
  const sideB: TradeSideAnalysis = {
    teamName: `Roster ${input.rosterIdB}`,
    players: bGivesProjections.map((p) => ({
      playerId: p.playerId,
      name: p.name,
      position: p.position,
      projectedROS: round(p.ros),
      scarcityAdjusted: round(p.scarcityAdjusted),
    })),
    totalRaw: round(bTotalRaw),
    totalAdjusted: round(bTotalAdj),
    rosterImpact: analyzeRosterImpact(rosterB, input.receivePlayerIds, input.sendPlayerIds, engine, ctx),
  };

  // Fairness: compare what each side RECEIVES (adjusted)
  // A receives bTotalAdj, B receives aTotalAdj
  const aReceives = bTotalAdj;
  const bReceives = aTotalAdj;
  const totalValue = aReceives + bReceives;

  // Score: 0 = perfectly fair, negative = favors A, positive = favors B
  let fairnessScore = 0;
  if (totalValue > 0) {
    fairnessScore = (bReceives - aReceives) / totalValue;
  }
  fairnessScore = Math.max(-1, Math.min(1, fairnessScore));

  const verdict = toVerdict(fairnessScore);
  const absDiff = Math.abs(aReceives - bReceives);
  const pctDiff = totalValue > 0 ? Math.round((absDiff / totalValue) * 200) : 0;

  let summary: string;
  if (verdict === 'fair') {
    summary = `This trade is well-balanced. Both sides receive roughly equal projected value.`;
  } else {
    const favoredSide = fairnessScore < 0 ? sideA.teamName : sideB.teamName;
    const severity = Math.abs(fairnessScore) > 0.3 ? 'significantly' : 'slightly';
    summary = `This trade ${severity} favors ${favoredSide}. They receive ~${pctDiff}% more projected rest-of-season value.`;
  }

  return {
    verdict,
    fairnessScore: round(fairnessScore),
    summary,
    sideA,
    sideB,
  };
}

// ── Helpers ───────────────────────────────────────────────────

function toVerdict(score: number): TradeVerdict {
  const abs = Math.abs(score);
  const side = score < 0 ? 'a' : 'b';
  if (abs < 0.08) return 'fair';
  if (abs < 0.20) return `slightly_favors_${side}` as TradeVerdict;
  if (abs < 0.35) return `favors_${side}` as TradeVerdict;
  return `heavily_favors_${side}` as TradeVerdict;
}

/**
 * Describe what a trade means for a roster's composition.
 * E.g. "Loses RB1 depth but gains an elite WR upgrade."
 */
function analyzeRosterImpact(
  roster: SleeperRoster,
  losingIds: string[],
  gainingIds: string[],
  engine: ProjectionEngine,
  ctx: ProjectionContext,
): string {
  const players = roster.players ?? [];
  const starters = new Set(roster.starters ?? []);

  // Count how many starters are being traded away
  const startersLost = losingIds.filter((id) => starters.has(id));
  const positionsLost = startersLost
    .map((id) => ctx.players[id]?.position)
    .filter(Boolean);
  const positionsGained = gainingIds
    .map((id) => ctx.players[id]?.position)
    .filter(Boolean);

  const parts: string[] = [];

  if (startersLost.length > 0) {
    parts.push(`Loses ${startersLost.length} starter(s) at ${[...new Set(positionsLost)].join(', ')}`);
  } else {
    parts.push('Trades bench depth only');
  }

  if (positionsGained.length > 0) {
    parts.push(`gains ${[...new Set(positionsGained)].join(', ')} talent`);
  }

  // Check for position count changes
  const posDelta = new Map<string, number>();
  for (const id of losingIds) {
    const pos = ctx.players[id]?.position ?? 'UNKNOWN';
    posDelta.set(pos, (posDelta.get(pos) ?? 0) - 1);
  }
  for (const id of gainingIds) {
    const pos = ctx.players[id]?.position ?? 'UNKNOWN';
    posDelta.set(pos, (posDelta.get(pos) ?? 0) + 1);
  }

  const thinPositions = [...posDelta.entries()]
    .filter(([, d]) => d < 0)
    .map(([pos]) => pos);

  if (thinPositions.length > 0) {
    parts.push(`thins ${thinPositions.join(', ')} depth`);
  }

  return parts.join('; ');
}

function sum(nums: number[]): number {
  return nums.reduce((a, b) => a + b, 0);
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
