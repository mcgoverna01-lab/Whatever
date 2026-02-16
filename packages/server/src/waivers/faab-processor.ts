import type pg from 'pg';
import { withTransaction } from '../db/pool.js';

interface FaabBidRow {
  id: string;
  league_id: string;
  member_id: string;
  gameweek: number;
  player_in_id: number;
  player_out_id: number;
  amount: number;
}

/**
 * Process FAAB bids for a league's gameweek.
 *
 * Algorithm (sealed-bid blind auction):
 * 1. Group all pending bids by player_in_id
 * 2. For each contested player:
 *    a. Highest bid wins
 *    b. Ties broken by waiver priority (lower = better)
 *    c. Winner pays their bid amount (not second-price)
 * 3. For each winning bid:
 *    a. Validate member has enough FAAB remaining
 *    b. Validate roster constraints
 *    c. Execute swap, deduct FAAB
 * 4. Reject all losing bids
 *
 * Key difference from standard waivers: FAAB doesn't rotate priority.
 * Priority is only used as a tiebreaker.
 */
export async function processFaabBids(
  leagueId: string,
  gameweek: number,
): Promise<{ approved: number; rejected: number }> {
  return withTransaction(async (client) => {
    // Fetch all pending FAAB bids with waiver priority for tiebreaking
    const bidsResult = await client.query<FaabBidRow & { waiver_priority: number }>(
      `SELECT fb.*, wp.priority as waiver_priority
       FROM faab_bids fb
       JOIN waiver_priority wp ON wp.league_id = fb.league_id AND wp.member_id = fb.member_id
       WHERE fb.league_id = $1 AND fb.gameweek = $2 AND fb.status = 'pending'
       ORDER BY fb.amount DESC, wp.priority ASC
       FOR UPDATE OF fb`,
      [leagueId, gameweek],
    );

    // Group bids by target player
    const bidsByPlayer = new Map<number, (typeof bidsResult.rows)>();
    for (const bid of bidsResult.rows) {
      if (!bidsByPlayer.has(bid.player_in_id)) {
        bidsByPlayer.set(bid.player_in_id, []);
      }
      bidsByPlayer.get(bid.player_in_id)!.push(bid);
    }

    let approved = 0;
    let rejected = 0;

    for (const [playerId, bids] of bidsByPlayer) {
      // Bids are already sorted: highest amount first, then waiver priority
      let playerClaimed = false;

      for (const bid of bids) {
        if (playerClaimed) {
          // Reject losing bids
          await client.query(
            `UPDATE faab_bids SET status = 'rejected', rejection_reason = 'Outbid',
             processed_at = now() WHERE id = $1`,
            [bid.id],
          );
          rejected++;
          continue;
        }

        // Try to process the winning bid
        const result = await processWinningFaabBid(client, bid);
        if (result.success) {
          playerClaimed = true;
          approved++;
        } else {
          rejected++;
          // If the highest bidder can't complete (insufficient FAAB, roster issues),
          // the next bidder gets a shot
        }
      }
    }

    return { approved, rejected };
  });
}

async function processWinningFaabBid(
  client: pg.PoolClient,
  bid: FaabBidRow,
): Promise<{ success: boolean }> {
  // Check FAAB budget
  const memberResult = await client.query<{ faab_remaining: number }>(
    `SELECT faab_remaining FROM league_members WHERE id = $1`,
    [bid.member_id],
  );
  const faabRemaining = memberResult.rows[0]?.faab_remaining ?? 0;

  if (bid.amount > faabRemaining) {
    await client.query(
      `UPDATE faab_bids SET status = 'rejected', rejection_reason = 'Insufficient FAAB budget',
       processed_at = now() WHERE id = $1`,
      [bid.id],
    );
    return { success: false };
  }

  // Check player is still available
  const onRoster = await client.query(
    `SELECT 1 FROM rosters WHERE player_id = $1`,
    [bid.player_in_id],
  );
  if (onRoster.rows.length > 0) {
    await client.query(
      `UPDATE faab_bids SET status = 'rejected', rejection_reason = 'Player no longer available',
       processed_at = now() WHERE id = $1`,
      [bid.id],
    );
    return { success: false };
  }

  // Check member still has the drop player
  const hasDrop = await client.query(
    `SELECT 1 FROM rosters WHERE member_id = $1 AND player_id = $2`,
    [bid.member_id, bid.player_out_id],
  );
  if (hasDrop.rows.length === 0) {
    await client.query(
      `UPDATE faab_bids SET status = 'rejected', rejection_reason = 'Drop player no longer on roster',
       processed_at = now() WHERE id = $1`,
      [bid.id],
    );
    return { success: false };
  }

  // Execute the swap
  await client.query(
    `DELETE FROM rosters WHERE member_id = $1 AND player_id = $2`,
    [bid.member_id, bid.player_out_id],
  );
  await client.query(
    `INSERT INTO rosters (member_id, player_id, slot)
     VALUES ($1, $2, 'BENCH')`,
    [bid.member_id, bid.player_in_id],
  );

  // Deduct FAAB
  await client.query(
    `UPDATE league_members SET faab_remaining = faab_remaining - $2 WHERE id = $1`,
    [bid.member_id, bid.amount],
  );

  // Mark bid approved
  await client.query(
    `UPDATE faab_bids SET status = 'approved', winning_amount = $2, processed_at = now()
     WHERE id = $1`,
    [bid.id, bid.amount],
  );

  // Log transaction
  await client.query(
    `INSERT INTO transactions (league_id, member_id, type, player_in_id, player_out_id, gameweek, faab_spent, source_id)
     VALUES ($1, $2, 'faab', $3, $4, $5, $6, $7)`,
    [bid.league_id, bid.member_id, bid.player_in_id, bid.player_out_id, bid.gameweek, bid.amount, bid.id],
  );

  return { success: true };
}
