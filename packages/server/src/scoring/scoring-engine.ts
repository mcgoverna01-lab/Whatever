import type pg from 'pg';
import { pool, withTransaction } from '../db/pool.js';
import { FPL_DEFAULT_SCORING, type ScoringRules, type AutoSub } from '@pitch-draft/shared';

interface RosterPlayerRow {
  player_id: number;
  slot: string;
  bench_order: number | null;
  position: string;
  minutes: number;
  goals: number;
  assists: number;
  clean_sheet: boolean;
  goals_conceded: number;
  saves: number;
  penalties_saved: number;
  penalties_missed: number;
  yellow_cards: number;
  red_cards: number;
  own_goals: number;
  bonus: number;
}

/**
 * Calculate a single player's gameweek score.
 */
export function calculatePlayerScore(
  stats: {
    position: string;
    minutes: number;
    goals: number;
    assists: number;
    cleanSheet: boolean;
    goalsConceded: number;
    saves: number;
    penaltiesSaved: number;
    penaltiesMissed: number;
    yellowCards: number;
    redCards: number;
    ownGoals: number;
    bonus: number;
  },
  rules: ScoringRules = FPL_DEFAULT_SCORING,
): number {
  let points = 0;

  // Appearance
  if (stats.minutes >= rules.minutesForAppearance) {
    points += rules.appearancePoints;
  }
  if (stats.minutes >= rules.minutesFor60Bonus) {
    points += rules.sixtyMinutePoints;
  }

  // Goals (position-dependent)
  const goalPoints: Record<string, number> = {
    GKP: rules.goalPointsGKP,
    DEF: rules.goalPointsDEF,
    MID: rules.goalPointsMID,
    FWD: rules.goalPointsFWD,
  };
  points += stats.goals * (goalPoints[stats.position] ?? 0);

  // Assists
  points += stats.assists * rules.assistPoints;

  // Clean sheets (only if played 60+ minutes)
  if (stats.cleanSheet && stats.minutes >= 60) {
    const csPoints: Record<string, number> = {
      GKP: rules.cleanSheetPointsGKP,
      DEF: rules.cleanSheetPointsDEF,
      MID: rules.cleanSheetPointsMID,
      FWD: rules.cleanSheetPointsFWD,
    };
    points += csPoints[stats.position] ?? 0;
  }

  // Goals conceded (GKP/DEF only, per threshold)
  if (stats.position === 'GKP' || stats.position === 'DEF') {
    if (stats.minutes >= 60) {
      const concededPenalties = Math.floor(stats.goalsConceded / rules.goalsConcededThreshold);
      const concededPoints =
        stats.position === 'GKP'
          ? rules.goalsConcededPointsGKP
          : rules.goalsConcededPointsDEF;
      points += concededPenalties * concededPoints;
    }
  }

  // Saves (GKP only)
  if (stats.position === 'GKP') {
    points += Math.floor(stats.saves / rules.savesForPoint) * rules.savePoints;
  }

  // Penalties
  points += stats.penaltiesSaved * rules.penaltySavePoints;
  points += stats.penaltiesMissed * rules.penaltyMissPoints;

  // Cards
  points += stats.yellowCards * rules.yellowCardPoints;
  points += stats.redCards * rules.redCardPoints;

  // Own goals
  points += stats.ownGoals * rules.ownGoalPoints;

  // Bonus
  if (rules.bonusEnabled) {
    points += stats.bonus;
  }

  return points;
}

/**
 * Process auto-substitutions for a team's gameweek.
 *
 * FPL auto-sub rules:
 * 1. If a starting player didn't play (0 minutes), sub in the first
 *    eligible bench player (by bench_order).
 * 2. The sub must maintain a valid formation (at least 1 GKP, 3 DEF, 2 MID, 1 FWD).
 * 3. GKP can only be subbed by GKP (bench slot 0 is always GKP).
 * 4. Process subs in bench order (0, 1, 2, 3).
 */
export function processAutoSubs(
  starters: Array<{ playerId: number; position: string; minutes: number }>,
  bench: Array<{ playerId: number; position: string; minutes: number; benchOrder: number }>,
): AutoSub[] {
  const subs: AutoSub[] = [];
  const activeStarters = [...starters];
  const availableBench = bench
    .filter((b) => b.minutes > 0)
    .sort((a, b) => a.benchOrder - b.benchOrder);

  // Find starters who didn't play
  const didNotPlay = activeStarters.filter((s) => s.minutes === 0);

  for (const absent of didNotPlay) {
    // Find eligible bench replacement
    const subIndex = availableBench.findIndex((b) => {
      // GKP can only replace GKP
      if (absent.position === 'GKP') return b.position === 'GKP';
      if (b.position === 'GKP') return false; // GKP bench can't replace outfield

      // Check formation validity after sub
      const remainingStarters = activeStarters.filter(
        (s) => s.playerId !== absent.playerId && s.minutes > 0,
      );
      const positionCounts = countPositions([...remainingStarters, { ...b, minutes: 1 }]);

      return isValidFormation(positionCounts);
    });

    if (subIndex === -1) continue;

    const sub = availableBench.splice(subIndex, 1)[0];
    subs.push({
      playerOut: absent.playerId,
      playerIn: sub.playerId,
      reason: 'did_not_play',
    });

    // Update active starters for subsequent sub checks
    const starterIdx = activeStarters.findIndex((s) => s.playerId === absent.playerId);
    activeStarters[starterIdx] = { ...sub, minutes: sub.minutes };
  }

  return subs;
}

function countPositions(
  players: Array<{ position: string }>,
): Record<string, number> {
  const counts: Record<string, number> = { GKP: 0, DEF: 0, MID: 0, FWD: 0 };
  for (const p of players) {
    counts[p.position] = (counts[p.position] ?? 0) + 1;
  }
  return counts;
}

function isValidFormation(counts: Record<string, number>): boolean {
  return (
    counts.GKP === 1 &&
    counts.DEF >= 3 &&
    counts.MID >= 2 &&
    counts.FWD >= 1 &&
    counts.DEF + counts.MID + counts.FWD === 10
  );
}

/**
 * Score a full gameweek for all teams in a league.
 * Fetches roster + stats, calculates points, applies auto-subs,
 * writes results to gameweek_team_scores.
 */
export async function scoreGameweek(
  leagueId: string,
  gameweek: number,
  rules: ScoringRules = FPL_DEFAULT_SCORING,
): Promise<void> {
  return withTransaction(async (client) => {
    // Get all members
    const membersResult = await client.query<{ id: string }>(
      `SELECT id FROM league_members WHERE league_id = $1`,
      [leagueId],
    );

    for (const member of membersResult.rows) {
      // Get roster with stats
      const rosterResult = await client.query<RosterPlayerRow>(
        `SELECT r.player_id, r.slot, r.bench_order, p.position,
                gs.minutes, gs.goals, gs.assists, gs.clean_sheet,
                gs.goals_conceded, gs.saves, gs.penalties_saved,
                gs.penalties_missed, gs.yellow_cards, gs.red_cards,
                gs.own_goals, gs.bonus
         FROM rosters r
         JOIN players p ON p.id = r.player_id
         LEFT JOIN gameweek_stats gs ON gs.player_id = r.player_id AND gs.gameweek = $2
         WHERE r.member_id = $1`,
        [member.id, gameweek],
      );

      const starters = rosterResult.rows
        .filter((r) => r.slot !== 'BENCH')
        .map((r) => ({
          playerId: r.player_id,
          position: r.position,
          minutes: r.minutes ?? 0,
        }));

      const bench = rosterResult.rows
        .filter((r) => r.slot === 'BENCH')
        .map((r) => ({
          playerId: r.player_id,
          position: r.position,
          minutes: r.minutes ?? 0,
          benchOrder: r.bench_order ?? 99,
        }));

      // Process auto-subs
      const autoSubs = processAutoSubs(starters, bench);

      // Build effective starting XI after auto-subs
      const effectiveStarters = new Set(starters.map((s) => s.playerId));
      for (const sub of autoSubs) {
        effectiveStarters.delete(sub.playerOut);
        effectiveStarters.add(sub.playerIn);
      }

      // Calculate points
      let startingPoints = 0;
      let benchPoints = 0;

      for (const row of rosterResult.rows) {
        if (!row.minutes) continue; // No stats = no points

        const playerPoints = calculatePlayerScore(
          {
            position: row.position,
            minutes: row.minutes,
            goals: row.goals,
            assists: row.assists,
            cleanSheet: row.clean_sheet,
            goalsConceded: row.goals_conceded,
            saves: row.saves,
            penaltiesSaved: row.penalties_saved,
            penaltiesMissed: row.penalties_missed,
            yellowCards: row.yellow_cards,
            redCards: row.red_cards,
            ownGoals: row.own_goals,
            bonus: row.bonus,
          },
          rules,
        );

        if (effectiveStarters.has(row.player_id)) {
          startingPoints += playerPoints;
        } else {
          benchPoints += playerPoints;
        }
      }

      // Upsert team score
      await client.query(
        `INSERT INTO gameweek_team_scores (member_id, gameweek, starting_points, bench_points, total_points, auto_subs)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (member_id, gameweek)
         DO UPDATE SET starting_points = $3, bench_points = $4, total_points = $5,
                       auto_subs = $6, calculated_at = now()`,
        [member.id, gameweek, startingPoints, benchPoints, startingPoints, JSON.stringify(autoSubs)],
      );
    }

    // Update league standings
    await updateStandings(client, leagueId, gameweek);
  });
}

async function updateStandings(
  client: pg.PoolClient,
  leagueId: string,
  gameweek: number,
): Promise<void> {
  // Calculate cumulative points up to this gameweek
  await client.query(
    `INSERT INTO league_standings (league_id, member_id, gameweek, total_points, rank)
     SELECT
       $1,
       lm.id,
       $2,
       COALESCE(SUM(gts.total_points), 0) as total_points,
       ROW_NUMBER() OVER (ORDER BY COALESCE(SUM(gts.total_points), 0) DESC) as rank
     FROM league_members lm
     LEFT JOIN gameweek_team_scores gts ON gts.member_id = lm.id AND gts.gameweek <= $2
     WHERE lm.league_id = $1
     GROUP BY lm.id
     ON CONFLICT (league_id, member_id, gameweek)
     DO UPDATE SET total_points = EXCLUDED.total_points, rank = EXCLUDED.rank`,
    [leagueId, gameweek],
  );
}
