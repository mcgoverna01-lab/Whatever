import { pool } from '../db/pool.js';
import { makePick, DraftError } from './draft-engine.js';

/**
 * Auto-pick strategy when a manager's timer expires.
 *
 * Priority order:
 * 1. Manager's pre-ranked player list (if set)
 * 2. Best available by total_points, respecting positional constraints
 *
 * The auto-pick must respect all the same constraints as a manual pick:
 * - Club limits (max 3)
 * - Positional limits
 * - Player availability (not already drafted)
 */
export async function executeAutoPick(
  draftId: string,
  memberId: string,
): Promise<ReturnType<typeof makePick>> {
  // Try manager's pre-ranked list first
  const rankingsResult = await pool.query<{ player_id: number }>(
    `SELECT player_id FROM auto_pick_rankings
     WHERE draft_id = $1 AND member_id = $2
     AND player_id NOT IN (
       SELECT player_id FROM draft_queue WHERE draft_id = $1 AND player_id IS NOT NULL
     )
     ORDER BY rank`,
    [draftId, memberId],
  );

  for (const { player_id } of rankingsResult.rows) {
    try {
      return await makePick(draftId, memberId, player_id, true);
    } catch (err) {
      if (err instanceof DraftError && (
        err.code === 'CLUB_LIMIT_EXCEEDED' ||
        err.code === 'POSITION_LIMIT_EXCEEDED' ||
        err.code === 'PLAYER_ALREADY_DRAFTED'
      )) {
        continue; // Skip this player, try next
      }
      throw err;
    }
  }

  // Fallback: best available by FPL total points
  const bestAvailable = await findBestAvailablePlayer(draftId, memberId);
  if (!bestAvailable) {
    throw new DraftError('No valid auto-pick available', 'NO_AUTO_PICK');
  }

  return makePick(draftId, memberId, bestAvailable, true);
}

/**
 * Find the best available player that satisfies all constraints.
 *
 * Uses a single query that filters out:
 * - Already drafted players
 * - Players from clubs where the member already has 3
 * - Players in positions where the member is at the limit
 */
async function findBestAvailablePlayer(
  draftId: string,
  memberId: string,
): Promise<number | null> {
  const result = await pool.query<{ id: number }>(`
    WITH drafted AS (
      SELECT player_id FROM draft_queue
      WHERE draft_id = $1 AND player_id IS NOT NULL
    ),
    my_roster AS (
      SELECT p.club_code, p.position
      FROM rosters r JOIN players p ON p.id = r.player_id
      WHERE r.member_id = $2
    ),
    club_counts AS (
      SELECT club_code, COUNT(*) as cnt FROM my_roster GROUP BY club_code
    ),
    pos_counts AS (
      SELECT position, COUNT(*) as cnt FROM my_roster GROUP BY position
    ),
    pos_limits (position, max_count) AS (
      VALUES ('GKP'::position_type, 2), ('DEF'::position_type, 5),
             ('MID'::position_type, 5), ('FWD'::position_type, 3)
    )
    SELECT p.id
    FROM players p
    WHERE p.id NOT IN (SELECT player_id FROM drafted)
      AND p.available = true
      AND COALESCE((SELECT cnt FROM club_counts WHERE club_code = p.club_code), 0) < 3
      AND COALESCE((SELECT cnt FROM pos_counts WHERE position = p.position::text), 0)
          < (SELECT max_count FROM pos_limits WHERE position = p.position)
    ORDER BY p.total_points DESC
    LIMIT 1
  `, [draftId, memberId]);

  return result.rows[0]?.id ?? null;
}
