import type pg from 'pg';
import { pool, withTransaction } from '../db/pool.js';

interface WaiverClaimRow {
  id: string;
  league_id: string;
  member_id: string;
  gameweek: number;
  player_in_id: number;
  player_out_id: number;
  priority: number;
}

interface WaiverPriorityRow {
  member_id: string;
  priority: number;
}

/**
 * Process waiver claims for a league's gameweek.
 *
 * Algorithm (standard rolling waivers):
 * 1. Fetch all pending claims for this league/gameweek
 * 2. Sort by: waiver_priority ASC, then member's claim priority ASC
 * 3. For each claim:
 *    a. Check if player_in is still available (not claimed by higher priority)
 *    b. Check if member still has player_out on roster
 *    c. Validate positional constraints after swap
 *    d. If valid: execute swap, mark approved, move member to bottom of waiver order
 *    e. If invalid: mark rejected with reason
 *
 * Waiver priority resets:
 * - After successful claim, claimant goes to the bottom (rolling)
 * - At season start, priority is inverse of previous season finish
 */
export async function processWaiverClaims(
  leagueId: string,
  gameweek: number,
): Promise<{ approved: number; rejected: number }> {
  return withTransaction(async (client) => {
    // Lock waiver claims for this league/gameweek
    const claimsResult = await client.query<WaiverClaimRow>(
      `SELECT wc.* FROM waiver_claims wc
       JOIN waiver_priority wp ON wp.league_id = wc.league_id AND wp.member_id = wc.member_id
       WHERE wc.league_id = $1 AND wc.gameweek = $2 AND wc.status = 'pending'
       ORDER BY wp.priority ASC, wc.priority ASC
       FOR UPDATE OF wc`,
      [leagueId, gameweek],
    );

    // Track which players have been claimed in this processing run
    const claimedPlayerIds = new Set<number>();
    // Track which players have been dropped (available for other claims)
    const droppedPlayerIds = new Set<number>();

    let approved = 0;
    let rejected = 0;

    for (const claim of claimsResult.rows) {
      const result = await processSingleClaim(client, claim, claimedPlayerIds, droppedPlayerIds);
      if (result.approved) {
        approved++;
        claimedPlayerIds.add(claim.player_in_id);
        droppedPlayerIds.add(claim.player_out_id);

        // Move claimant to bottom of waiver priority
        await rotateWaiverPriority(client, leagueId, claim.member_id);
      } else {
        rejected++;
      }
    }

    return { approved, rejected };
  });
}

async function processSingleClaim(
  client: pg.PoolClient,
  claim: WaiverClaimRow,
  claimedPlayerIds: Set<number>,
  droppedPlayerIds: Set<number>,
): Promise<{ approved: boolean }> {
  // Check if player_in was already claimed by a higher-priority claim
  if (claimedPlayerIds.has(claim.player_in_id)) {
    await rejectClaim(client, claim.id, 'Player already claimed by higher priority');
    return { approved: false };
  }

  // Check if player_in is on anyone's roster (and wasn't just dropped)
  if (!droppedPlayerIds.has(claim.player_in_id)) {
    const onRoster = await client.query(
      `SELECT 1 FROM rosters WHERE player_id = $1`,
      [claim.player_in_id],
    );
    if (onRoster.rows.length > 0) {
      await rejectClaim(client, claim.id, 'Player is not a free agent');
      return { approved: false };
    }
  }

  // Check if member still has player_out on roster
  const hasPlayerOut = await client.query(
    `SELECT 1 FROM rosters WHERE member_id = $1 AND player_id = $2`,
    [claim.member_id, claim.player_out_id],
  );
  if (hasPlayerOut.rows.length === 0) {
    await rejectClaim(client, claim.id, 'You no longer have the player you offered to drop');
    return { approved: false };
  }

  // Validate positional constraints after swap
  const valid = await validateWaiverSwap(
    client,
    claim.member_id,
    claim.player_in_id,
    claim.player_out_id,
  );
  if (!valid.ok) {
    await rejectClaim(client, claim.id, valid.reason);
    return { approved: false };
  }

  // Execute the swap
  await client.query(
    `DELETE FROM rosters WHERE member_id = $1 AND player_id = $2`,
    [claim.member_id, claim.player_out_id],
  );
  await client.query(
    `INSERT INTO rosters (member_id, player_id, slot)
     VALUES ($1, $2, 'BENCH')`,
    [claim.member_id, claim.player_in_id],
  );

  // Mark claim approved
  await client.query(
    `UPDATE waiver_claims SET status = 'approved', processed_at = now() WHERE id = $1`,
    [claim.id],
  );

  // Log transaction
  await client.query(
    `INSERT INTO transactions (league_id, member_id, type, player_in_id, player_out_id, gameweek, source_id)
     VALUES ($1, $2, 'waiver', $3, $4, $5, $6)`,
    [claim.league_id, claim.member_id, claim.player_in_id, claim.player_out_id, claim.gameweek, claim.id],
  );

  return { approved: true };
}

async function validateWaiverSwap(
  client: pg.PoolClient,
  memberId: string,
  playerInId: number,
  playerOutId: number,
): Promise<{ ok: boolean; reason: string }> {
  // Get both players' info
  const [playerIn, playerOut] = await Promise.all([
    client.query<{ position: string; club_code: string }>(
      'SELECT position, club_code FROM players WHERE id = $1',
      [playerInId],
    ),
    client.query<{ position: string; club_code: string }>(
      'SELECT position, club_code FROM players WHERE id = $1',
      [playerOutId],
    ),
  ]);

  const pIn = playerIn.rows[0];
  const pOut = playerOut.rows[0];

  // Club limit check (simulate the swap)
  if (pIn.club_code !== pOut.club_code) {
    const clubCount = await client.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM rosters r
       JOIN players p ON p.id = r.player_id
       WHERE r.member_id = $1 AND p.club_code = $2 AND r.player_id != $3`,
      [memberId, pIn.club_code, playerOutId],
    );
    if (parseInt(clubCount.rows[0].count) >= 3) {
      return { ok: false, reason: `Already have 3 players from ${pIn.club_code}` };
    }
  }

  // Position limit check (simulate the swap)
  if (pIn.position !== pOut.position) {
    const posLimits: Record<string, number> = { GKP: 2, DEF: 5, MID: 5, FWD: 3 };
    const posCount = await client.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM rosters r
       JOIN players p ON p.id = r.player_id
       WHERE r.member_id = $1 AND p.position = $2 AND r.player_id != $3`,
      [memberId, pIn.position, playerOutId],
    );
    if (parseInt(posCount.rows[0].count) >= posLimits[pIn.position]) {
      return { ok: false, reason: `Already at max ${pIn.position} capacity` };
    }
  }

  return { ok: true, reason: '' };
}

async function rejectClaim(
  client: pg.PoolClient,
  claimId: string,
  reason: string,
): Promise<void> {
  await client.query(
    `UPDATE waiver_claims SET status = 'rejected', rejection_reason = $2, processed_at = now()
     WHERE id = $1`,
    [claimId, reason],
  );
}

/**
 * After a successful waiver claim, move the claimant to the bottom
 * of the waiver priority order (rolling waivers).
 */
async function rotateWaiverPriority(
  client: pg.PoolClient,
  leagueId: string,
  memberId: string,
): Promise<void> {
  // Get current priority of the claimant
  const current = await client.query<WaiverPriorityRow>(
    `SELECT * FROM waiver_priority WHERE league_id = $1 AND member_id = $2`,
    [leagueId, memberId],
  );
  if (current.rows.length === 0) return;

  const oldPriority = current.rows[0].priority;

  // Get max priority (bottom)
  const maxResult = await client.query<{ max: number }>(
    `SELECT MAX(priority) as max FROM waiver_priority WHERE league_id = $1`,
    [leagueId],
  );
  const maxPriority = maxResult.rows[0].max;

  if (oldPriority === maxPriority) return; // Already at bottom

  // Move everyone between old+1 and max up by one
  await client.query(
    `UPDATE waiver_priority
     SET priority = priority - 1
     WHERE league_id = $1 AND priority > $2 AND priority <= $3`,
    [leagueId, oldPriority, maxPriority],
  );

  // Move claimant to bottom
  await client.query(
    `UPDATE waiver_priority SET priority = $3
     WHERE league_id = $1 AND member_id = $2`,
    [leagueId, memberId, maxPriority],
  );
}
