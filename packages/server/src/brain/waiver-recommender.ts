import { SQUAD_CONSTRAINTS } from '@pitch-draft/shared';
import type { Position } from '@pitch-draft/shared';
import type { ProjectionEngine } from './projection/engine.js';
import { FplClient } from './fpl-client.js';
import type {
  ProjectionContext,
  WaiverAnalysis,
  WaiverRecommendation,
  BrainRoster,
  PlayerProjection,
} from './types.js';

/** FPL starter slots per position. */
const STARTER_SLOTS: Record<Position, number> = { GKP: 1, DEF: 3, MID: 2, FWD: 1 };
/** Min starters in a valid XI (1 GKP + 10 outfield). */
const MIN_MINUTES_THRESHOLD = 200;

interface WaiverInput {
  roster: BrainRoster;
  allRosters: BrainRoster[];
  limit?: number;
}

/**
 * Analyze a roster and recommend waiver pickups.
 *
 * Smarter than "best available": considers roster needs, FPL constraints,
 * fixture runs, and filters out players unlikely to play.
 *
 * 1. Identify roster weaknesses by position
 * 2. Filter free agents: must have minutes > 200, active status, valid position
 * 3. Check FPL constraints (3-per-club, position limits) before recommending
 * 4. Rank by net improvement to the specific roster
 */
export function recommendWaivers(
  input: WaiverInput,
  engine: ProjectionEngine,
  ctx: ProjectionContext,
): WaiverAnalysis {
  const limit = input.limit ?? 10;
  const roster = input.roster;

  // Project every player on this roster
  const rosterProjections = roster.playerIds.map((id) => engine.projectPlayer(id, ctx));

  // Analyze roster needs
  const rosterNeeds = analyzeNeeds(rosterProjections, ctx);

  // Find free agents (not on ANY roster)
  const rosteredIds = new Set<number>();
  for (const r of input.allRosters) {
    for (const id of r.playerIds) rosteredIds.add(id);
  }

  // Smart filtering: only relevant, active players with real minutes
  const freeAgentIds: number[] = [];
  for (const [id, player] of ctx.players) {
    if (
      !rosteredIds.has(id) &&
      player.status === 'a' &&
      player.minutes >= MIN_MINUTES_THRESHOLD &&
      isRelevantPosition(player.position)
    ) {
      freeAgentIds.push(id);
    }
  }

  // Project free agents and sort by ROS value
  const faProjections = freeAgentIds
    .map((id) => engine.projectPlayer(id, ctx))
    .filter((p) => p.ppg > 0.5)
    .sort((a, b) => b.ros - a.ros);

  // Build recommendations with constraint checking
  const recommendations: WaiverRecommendation[] = [];
  const currentClubCounts = countClubs(roster.playerIds, ctx);
  const currentPosCounts = countPositions(roster.playerIds, ctx);

  for (const fa of faProjections) {
    if (recommendations.length >= limit) break;

    const player = ctx.players.get(fa.playerId);
    if (!player) continue;

    // Find who to drop
    const dropResult = findBestDrop(fa, rosterProjections, player, currentClubCounts, currentPosCounts, ctx);
    if (!dropResult) continue;

    // Verify club limit: adding this player (after dropping)
    const dropPlayer = ctx.players.get(dropResult.drop.playerId);
    const netClubChange = player.clubCode === dropPlayer?.clubCode ? 0 : 1;
    const clubCount = currentClubCounts.get(player.clubCode) ?? 0;
    const dropClubCount = dropPlayer ? (player.clubCode === dropPlayer.clubCode ? 0 : 1) : 0;
    if (clubCount + netClubChange - dropClubCount > SQUAD_CONSTRAINTS.maxPerClub) continue;

    // Verify position limits
    if (player.position !== dropPlayer?.position) {
      const posCount = currentPosCounts[player.position] ?? 0;
      const posLimit = SQUAD_CONSTRAINTS.positions[player.position as keyof typeof SQUAD_CONSTRAINTS.positions];
      if (posLimit && posCount >= posLimit.max) continue;
    }

    const fixtureRun = FplClient.averageFdr(player.teamId, ctx.fixtures, ctx.currentGameweek + 1, 5);

    recommendations.push({
      player: {
        playerId: fa.playerId,
        name: fa.name,
        position: fa.position,
        clubCode: fa.clubCode,
        form: player.form,
        fixtureRun: round(fixtureRun),
      },
      projectedROS: round(fa.ros),
      improvementOver: {
        playerId: dropResult.drop.playerId,
        name: dropResult.drop.name,
        position: dropResult.drop.position,
        projectedROS: round(dropResult.drop.ros),
      },
      netGain: round(dropResult.netGain),
      reason: dropResult.reason,
      suggestedDrop: {
        playerId: dropResult.drop.playerId,
        name: dropResult.drop.name,
        position: dropResult.drop.position,
        clubCode: ctx.players.get(dropResult.drop.playerId)?.clubCode ?? '???',
      },
    });
  }

  return { rosterNeeds, recommendations };
}

// ── Internals ─────────────────────────────────────────────────

function analyzeNeeds(
  projections: PlayerProjection[],
  ctx: ProjectionContext,
): WaiverAnalysis['rosterNeeds'] {
  const needs: WaiverAnalysis['rosterNeeds'] = [];
  const byPos = groupBy(projections, (p) => p.position);

  for (const pos of ['GKP', 'DEF', 'MID', 'FWD'] as Position[]) {
    const players = byPos[pos] ?? [];
    const required = SQUAD_CONSTRAINTS.positions[pos].min;
    const sorted = [...players].sort((a, b) => b.ros - a.ros);
    const starters = sorted.slice(0, STARTER_SLOTS[pos]);
    const avgPpg = starters.length > 0
      ? starters.reduce((s, p) => s + p.ppg, 0) / starters.length
      : 0;

    const baseline = positionBaselineThreshold(pos);

    if (players.length < required) {
      needs.push({
        position: pos,
        severity: 'high',
        reason: `Only ${players.length} ${pos}(s) rostered — need ${required}.`,
      });
    } else if (players.length <= STARTER_SLOTS[pos]) {
      needs.push({
        position: pos,
        severity: 'high',
        reason: `No ${pos} bench depth — any injury leaves you without a sub.`,
      });
    } else if (avgPpg < baseline * 0.7) {
      needs.push({
        position: pos,
        severity: 'high',
        reason: `${pos} starters averaging ${round(avgPpg)} PPG — well below league average (${baseline}).`,
      });
    } else if (avgPpg < baseline) {
      needs.push({
        position: pos,
        severity: 'medium',
        reason: `${pos} starters averaging ${round(avgPpg)} PPG — below average (${baseline}).`,
      });
    }
  }

  needs.sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 };
    return order[a.severity] - order[b.severity];
  });

  return needs;
}

function findBestDrop(
  fa: PlayerProjection,
  rosterProjections: PlayerProjection[],
  faPlayer: { position: Position; clubCode: string },
  clubCounts: Map<string, number>,
  posCounts: Record<string, number>,
  ctx: ProjectionContext,
): { drop: PlayerProjection; netGain: number; reason: string } | null {
  // Sort roster by ROS ascending (worst first)
  const sorted = [...rosterProjections].sort((a, b) => a.ros - b.ros);

  // Prefer dropping same position (maintains squad structure)
  const samePosDrops = sorted.filter((p) => p.position === fa.position);
  if (samePosDrops.length > 0) {
    const worst = samePosDrops[0];
    const netGain = fa.ros - worst.ros;
    if (netGain > 1) {
      const fixtureNote = faPlayer.clubCode
        ? ` ${faPlayer.clubCode} have favorable upcoming fixtures.`
        : '';
      return {
        drop: worst,
        netGain,
        reason: `${fa.name} projects ${round(fa.ros)} ROS pts vs ${worst.name}'s ${round(worst.ros)}.${fixtureNote}`,
      };
    }
  }

  // Cross-position drop: only if we'd still meet position minimums
  for (const candidate of sorted) {
    if (candidate.position === fa.position) continue;
    const posCount = posCounts[candidate.position] ?? 0;
    const minRequired = SQUAD_CONSTRAINTS.positions[candidate.position as keyof typeof SQUAD_CONSTRAINTS.positions]?.min ?? 0;
    if (posCount <= minRequired) continue; // can't go below minimum

    const netGain = fa.ros - candidate.ros;
    if (netGain > 3) {
      return {
        drop: candidate,
        netGain,
        reason: `${fa.name} (${fa.position}) adds ${round(netGain)} more ROS pts than ${candidate.name} (${candidate.position}).`,
      };
    }
  }

  return null;
}

function countClubs(playerIds: number[], ctx: ProjectionContext): Map<string, number> {
  const counts = new Map<string, number>();
  for (const id of playerIds) {
    const p = ctx.players.get(id);
    if (p) counts.set(p.clubCode, (counts.get(p.clubCode) ?? 0) + 1);
  }
  return counts;
}

function countPositions(playerIds: number[], ctx: ProjectionContext): Record<string, number> {
  const counts: Record<string, number> = { GKP: 0, DEF: 0, MID: 0, FWD: 0 };
  for (const id of playerIds) {
    const p = ctx.players.get(id);
    if (p && p.position in counts) counts[p.position]++;
  }
  return counts;
}

function positionBaselineThreshold(pos: Position): number {
  const thresholds: Record<string, number> = { GKP: 4.0, DEF: 4.2, MID: 5.0, FWD: 4.5 };
  return thresholds[pos] ?? 4.0;
}

function isRelevantPosition(pos: string): boolean {
  return ['GKP', 'DEF', 'MID', 'FWD'].includes(pos);
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
