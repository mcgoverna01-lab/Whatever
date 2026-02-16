import type pg from 'pg';
import { pool, query, withTransaction } from '../db/pool.js';
import { generateH2HSchedule } from './schedule-generator.js';

/**
 * Initialize H2H schedule for a league.
 * Call after the draft completes and the league enters 'active' status.
 *
 * @param leagueId League ID
 * @param startGameweek First gameweek to schedule (usually the next upcoming GW)
 * @param endGameweek Last gameweek (38 for a full PL season)
 */
export async function initializeH2HSchedule(
  leagueId: string,
  startGameweek: number = 1,
  endGameweek: number = 38,
): Promise<number> {
  return withTransaction(async (client) => {
    // Get members ordered by draft seed
    const membersResult = await client.query<{ id: string }>(
      `SELECT id FROM league_members WHERE league_id = $1 ORDER BY draft_seed`,
      [leagueId],
    );
    const members = membersResult.rows;

    const totalGameweeks = endGameweek - startGameweek + 1;
    const schedule = generateH2HSchedule(members.length, totalGameweeks);

    let inserted = 0;
    for (const matchup of schedule) {
      const actualGameweek = startGameweek + matchup.gameweek - 1;
      if (actualGameweek > endGameweek) break;

      await client.query(
        `INSERT INTO h2h_schedule (league_id, gameweek, home_member_id, away_member_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT DO NOTHING`,
        [leagueId, actualGameweek, members[matchup.homeIndex].id, members[matchup.awayIndex].id],
      );
      inserted++;
    }

    return inserted;
  });
}

/**
 * Calculate H2H results for a completed gameweek.
 * Uses each team's gameweek_team_scores total.
 *
 * Must be called AFTER scoreGameweek() has run for this GW.
 */
export async function calculateH2HResults(
  leagueId: string,
  gameweek: number,
): Promise<number> {
  return withTransaction(async (client) => {
    // Get all matchups for this gameweek
    const matchupsResult = await client.query<{
      id: string;
      home_member_id: string;
      away_member_id: string;
    }>(
      `SELECT id, home_member_id, away_member_id FROM h2h_schedule
       WHERE league_id = $1 AND gameweek = $2`,
      [leagueId, gameweek],
    );

    if (matchupsResult.rows.length === 0) return 0;

    // Get all team scores for this gameweek
    const scoresResult = await client.query<{
      member_id: string;
      total_points: number;
    }>(
      `SELECT member_id, total_points FROM gameweek_team_scores
       WHERE member_id IN (SELECT id FROM league_members WHERE league_id = $1)
       AND gameweek = $2`,
      [leagueId, gameweek],
    );

    const scoreMap = new Map<string, number>();
    for (const row of scoresResult.rows) {
      scoreMap.set(row.member_id, row.total_points);
    }

    let processed = 0;
    for (const matchup of matchupsResult.rows) {
      const homePoints = scoreMap.get(matchup.home_member_id) ?? 0;
      const awayPoints = scoreMap.get(matchup.away_member_id) ?? 0;

      let winner: string;
      if (homePoints > awayPoints) winner = 'home';
      else if (awayPoints > homePoints) winner = 'away';
      else winner = 'draw';

      await client.query(
        `INSERT INTO h2h_results (schedule_id, home_points, away_points, winner)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (schedule_id) DO UPDATE SET
           home_points = $2, away_points = $3, winner = $4, calculated_at = now()`,
        [matchup.id, homePoints, awayPoints, winner],
      );
      processed++;
    }

    // Update H2H standings
    await updateH2HStandings(client, leagueId, gameweek);

    return processed;
  });
}

/**
 * Recalculate H2H standings up to and including the given gameweek.
 * H2H points: 3 for win, 1 for draw, 0 for loss.
 * Tiebreaker: cumulative FPL total points.
 */
async function updateH2HStandings(
  client: pg.PoolClient,
  leagueId: string,
  upToGameweek: number,
): Promise<void> {
  await client.query(
    `INSERT INTO h2h_standings (league_id, member_id, gameweek, wins, draws, losses, h2h_points, total_score, rank)
     SELECT
       $1 as league_id,
       lm.id as member_id,
       $2 as gameweek,
       COALESCE(SUM(CASE
         WHEN (hs.home_member_id = lm.id AND hr.winner = 'home')
           OR (hs.away_member_id = lm.id AND hr.winner = 'away')
         THEN 1 ELSE 0 END), 0) as wins,
       COALESCE(SUM(CASE WHEN hr.winner = 'draw'
         AND (hs.home_member_id = lm.id OR hs.away_member_id = lm.id)
         THEN 1 ELSE 0 END), 0) as draws,
       COALESCE(SUM(CASE
         WHEN (hs.home_member_id = lm.id AND hr.winner = 'away')
           OR (hs.away_member_id = lm.id AND hr.winner = 'home')
         THEN 1 ELSE 0 END), 0) as losses,
       COALESCE(SUM(CASE
         WHEN (hs.home_member_id = lm.id AND hr.winner = 'home')
           OR (hs.away_member_id = lm.id AND hr.winner = 'away')
         THEN 3
         WHEN hr.winner = 'draw'
           AND (hs.home_member_id = lm.id OR hs.away_member_id = lm.id)
         THEN 1
         ELSE 0 END), 0) as h2h_points,
       COALESCE((SELECT SUM(gts.total_points)
                 FROM gameweek_team_scores gts
                 WHERE gts.member_id = lm.id AND gts.gameweek <= $2), 0) as total_score,
       0 as rank  -- placeholder, computed below
     FROM league_members lm
     LEFT JOIN h2h_schedule hs ON (hs.home_member_id = lm.id OR hs.away_member_id = lm.id)
       AND hs.league_id = $1 AND hs.gameweek <= $2
     LEFT JOIN h2h_results hr ON hr.schedule_id = hs.id
     WHERE lm.league_id = $1
     GROUP BY lm.id
     ON CONFLICT (league_id, member_id, gameweek) DO UPDATE SET
       wins = EXCLUDED.wins,
       draws = EXCLUDED.draws,
       losses = EXCLUDED.losses,
       h2h_points = EXCLUDED.h2h_points,
       total_score = EXCLUDED.total_score`,
    [leagueId, upToGameweek],
  );

  // Now compute ranks (ORDER BY h2h_points DESC, total_score DESC)
  await client.query(
    `WITH ranked AS (
       SELECT member_id,
              ROW_NUMBER() OVER (ORDER BY h2h_points DESC, total_score DESC) as rn
       FROM h2h_standings
       WHERE league_id = $1 AND gameweek = $2
     )
     UPDATE h2h_standings SET rank = r.rn
     FROM ranked r
     WHERE h2h_standings.league_id = $1
       AND h2h_standings.gameweek = $2
       AND h2h_standings.member_id = r.member_id`,
    [leagueId, upToGameweek],
  );
}

/**
 * Get H2H standings for a league.
 */
export async function getH2HStandings(leagueId: string, gameweek?: number) {
  let gw = gameweek;
  if (!gw) {
    const latest = await query<{ gameweek: number }>(
      `SELECT MAX(gameweek) as gameweek FROM h2h_standings WHERE league_id = $1`,
      [leagueId],
    );
    gw = latest.rows[0]?.gameweek;
    if (!gw) return [];
  }

  const result = await query(
    `SELECT hs.*, lm.team_name
     FROM h2h_standings hs
     JOIN league_members lm ON lm.id = hs.member_id
     WHERE hs.league_id = $1 AND hs.gameweek = $2
     ORDER BY hs.rank`,
    [leagueId, gw],
  );

  return result.rows;
}

/**
 * Get H2H fixtures for a gameweek.
 */
export async function getH2HFixtures(leagueId: string, gameweek: number) {
  const result = await query(
    `SELECT
       hs.id, hs.gameweek,
       hs.home_member_id, home_lm.team_name as home_team,
       hs.away_member_id, away_lm.team_name as away_team,
       hr.home_points, hr.away_points, hr.winner
     FROM h2h_schedule hs
     JOIN league_members home_lm ON home_lm.id = hs.home_member_id
     JOIN league_members away_lm ON away_lm.id = hs.away_member_id
     LEFT JOIN h2h_results hr ON hr.schedule_id = hs.id
     WHERE hs.league_id = $1 AND hs.gameweek = $2
     ORDER BY hs.id`,
    [leagueId, gameweek],
  );

  return result.rows;
}
