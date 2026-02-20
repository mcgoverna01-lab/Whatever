import type { ProjectionEngine } from './projection/engine.js';
import type {
  ProjectionContext,
  WaiverAnalysis,
  WaiverRecommendation,
  SleeperRoster,
} from './types.js';

interface WaiverInput {
  /** The roster to analyze */
  rosterId: number;
  /** Max recommendations to return */
  limit?: number;
}

/**
 * Analyze a roster and recommend waiver pickups.
 *
 * This is NOT just "best available players." It's:
 * 1. What positions is this roster weakest at?
 * 2. Who's available that would improve THOSE positions?
 * 3. Who should be dropped to make room?
 * 4. Ranked by net improvement to the starting lineup.
 */
export function recommendWaivers(
  input: WaiverInput,
  rosters: SleeperRoster[],
  engine: ProjectionEngine,
  ctx: ProjectionContext,
): WaiverAnalysis {
  const limit = input.limit ?? 10;
  const roster = rosters.find((r) => r.roster_id === input.rosterId);
  if (!roster) {
    throw Object.assign(new Error('Roster not found'), {
      status: 400,
      code: 'ROSTER_NOT_FOUND',
    });
  }

  const playerIds = roster.players ?? [];
  const starterIds = new Set(roster.starters ?? []);

  // Project every player on this roster
  const rosterProjections = playerIds.map((id) => ({
    ...engine.projectPlayer(id, ctx),
    isStarter: starterIds.has(id),
  }));

  // Figure out roster positions (how many starters at each pos)
  const positionSlots = countStarterSlots(ctx.league.roster_positions);

  // Analyze roster needs
  const rosterNeeds = analyzeNeeds(rosterProjections, positionSlots, engine, ctx);

  // Find all free agents (not on any roster)
  const rosteredIds = new Set<string>();
  for (const r of rosters) {
    if (r.players) {
      for (const id of r.players) rosteredIds.add(id);
    }
  }

  // Filter to relevant free agents (real NFL players with a team)
  const freeAgents: string[] = [];
  for (const [id, player] of Object.entries(ctx.players)) {
    if (
      !rosteredIds.has(id) &&
      player.team &&
      player.status === 'Active' &&
      isRelevantPosition(player.position)
    ) {
      freeAgents.push(id);
    }
  }

  // Project all free agents
  const faProjections = freeAgents
    .map((id) => engine.projectPlayer(id, ctx))
    .filter((p) => p.ppg > 0)
    .sort((a, b) => b.ros - a.ros);

  // For each free agent, calculate the net improvement if they replaced
  // the weakest player at their position (or a droppable bench player)
  const recommendations: WaiverRecommendation[] = [];

  for (const fa of faProjections) {
    if (recommendations.length >= limit) break;

    const { worstPlayer, netGain, reason } = findBestSwap(
      fa,
      rosterProjections,
      positionSlots,
      engine,
      ctx,
    );

    // Only recommend if there's meaningful improvement
    if (netGain <= 0.5) continue;

    recommendations.push({
      player: {
        playerId: fa.playerId,
        name: fa.name,
        position: fa.position,
        team: fa.team,
      },
      projectedROS: round(fa.ros),
      improvementOver: worstPlayer
        ? {
            playerId: worstPlayer.playerId,
            name: worstPlayer.name,
            position: worstPlayer.position,
            projectedROS: round(worstPlayer.ros),
          }
        : null,
      netGain: round(netGain),
      reason,
      suggestedDrop: worstPlayer
        ? {
            playerId: worstPlayer.playerId,
            name: worstPlayer.name,
            position: worstPlayer.position,
          }
        : null,
    });
  }

  return { rosterNeeds, recommendations };
}

// ── Internals ─────────────────────────────────────────────────

interface RosterProjection {
  playerId: string;
  name: string;
  position: string;
  team: string | null;
  ros: number;
  ppg: number;
  confidence: number;
  isStarter: boolean;
}

/**
 * Count how many starter slots each position gets.
 * FLEX counts as a fractional slot across eligible positions.
 */
function countStarterSlots(
  rosterPositions: string[],
): Record<string, number> {
  const slots: Record<string, number> = { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DEF: 0 };

  for (const pos of rosterPositions) {
    if (pos === 'BN' || pos === 'IR') continue;
    if (pos === 'FLEX') {
      // FLEX is typically RB/WR/TE — credit each equally
      slots.RB += 0.34;
      slots.WR += 0.34;
      slots.TE += 0.32;
    } else if (pos === 'SUPER_FLEX' || pos === 'SUPERFLEX') {
      slots.QB += 0.4;
      slots.RB += 0.2;
      slots.WR += 0.2;
      slots.TE += 0.2;
    } else if (pos === 'REC_FLEX') {
      slots.WR += 0.5;
      slots.TE += 0.5;
    } else if (pos in slots) {
      slots[pos] += 1;
    }
  }

  return slots;
}

function analyzeNeeds(
  rosterProjections: RosterProjection[],
  positionSlots: Record<string, number>,
  engine: ProjectionEngine,
  ctx: ProjectionContext,
): WaiverAnalysis['rosterNeeds'] {
  const needs: WaiverAnalysis['rosterNeeds'] = [];
  const posGroups = groupBy(rosterProjections, (p) => p.position);

  for (const [pos, slotCount] of Object.entries(positionSlots)) {
    if (slotCount < 0.5) continue; // Not a starter position worth analyzing
    const playersAtPos = posGroups[pos] ?? [];
    const sortedByRos = [...playersAtPos].sort((a, b) => b.ros - a.ros);
    const starterCount = Math.ceil(slotCount);

    // How good are the starters?
    const starters = sortedByRos.slice(0, starterCount);
    const avgPpg = starters.length > 0
      ? starters.reduce((s, p) => s + p.ppg, 0) / starters.length
      : 0;

    const baseline = positionBaselineThreshold(pos);
    const depth = playersAtPos.length;

    if (depth <= starterCount) {
      needs.push({
        position: pos,
        severity: 'high',
        reason: `Only ${depth} ${pos}(s) rostered — no bench depth behind ${starterCount} starter slot(s).`,
      });
    } else if (avgPpg < baseline * 0.75) {
      needs.push({
        position: pos,
        severity: 'high',
        reason: `${pos} starters averaging ${round(avgPpg)} PPG — well below league average.`,
      });
    } else if (avgPpg < baseline) {
      needs.push({
        position: pos,
        severity: 'medium',
        reason: `${pos} starters averaging ${round(avgPpg)} PPG — slightly below average.`,
      });
    }
  }

  // Sort high → low severity
  const severityOrder = { high: 0, medium: 1, low: 2 };
  needs.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return needs;
}

function findBestSwap(
  freeAgent: { playerId: string; name: string; position: string; team: string | null; ros: number; ppg: number },
  rosterProjections: RosterProjection[],
  positionSlots: Record<string, number>,
  engine: ProjectionEngine,
  ctx: ProjectionContext,
): { worstPlayer: RosterProjection | null; netGain: number; reason: string } {
  // Find droppable players: bench players, or the worst player at a surplus position
  const samePos = rosterProjections
    .filter((p) => p.position === freeAgent.position)
    .sort((a, b) => a.ros - b.ros);

  const benchAtPos = samePos.filter((p) => !p.isStarter);

  // Primary target: worst bench player at the same position
  if (benchAtPos.length > 0) {
    const worst = benchAtPos[0];
    const netGain = freeAgent.ros - worst.ros;
    return {
      worstPlayer: worst,
      netGain,
      reason: `${freeAgent.name} projects ${round(freeAgent.ros)} ROS pts, replacing bench ${freeAgent.position} ${worst.name} (${round(worst.ros)}).`,
    };
  }

  // Secondary: worst bench player at any position (if this FA is a starter-level upgrade)
  const allBench = rosterProjections
    .filter((p) => !p.isStarter)
    .sort((a, b) => a.ros - b.ros);

  if (allBench.length > 0) {
    const worst = allBench[0];
    const netGain = freeAgent.ros - worst.ros;
    if (netGain > 0) {
      return {
        worstPlayer: worst,
        netGain,
        reason: `${freeAgent.name} (${freeAgent.position}) adds ${round(netGain)} ROS pts over bench player ${worst.name} (${worst.position}).`,
      };
    }
  }

  // No good swap
  return { worstPlayer: null, netGain: 0, reason: '' };
}

/** PPG thresholds for an "average" starter (roughly league median). */
function positionBaselineThreshold(pos: string): number {
  const thresholds: Record<string, number> = {
    QB: 18,
    RB: 12,
    WR: 12,
    TE: 9,
    K: 8,
    DEF: 7,
  };
  return thresholds[pos] ?? 6;
}

function isRelevantPosition(pos: string): boolean {
  return ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].includes(pos);
}

function groupBy<T>(arr: T[], fn: (item: T) => string): Record<string, T[]> {
  const result: Record<string, T[]> = {};
  for (const item of arr) {
    const key = fn(item);
    if (!result[key]) result[key] = [];
    result[key].push(item);
  }
  return result;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
