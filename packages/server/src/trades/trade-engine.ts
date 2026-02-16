import type pg from 'pg';
import { pool, query, withTransaction } from '../db/pool.js';

interface TradeProposal {
  leagueId: string;
  proposerId: string;
  recipientId: string;
  /** Players moving from proposer → recipient */
  proposerOffers: number[];
  /** Players moving from recipient → proposer */
  recipientOffers: number[];
  message?: string;
}

interface TradeRow {
  id: string;
  league_id: string;
  proposer_id: string;
  recipient_id: string;
  status: string;
  veto_deadline: string | null;
  message: string | null;
}

export class TradeError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'TradeError';
  }
}

/**
 * Propose a trade between two managers.
 *
 * Validates:
 * - Both sides own the players they're offering
 * - The resulting rosters maintain positional/club constraints
 * - Neither side would exceed max 3 from any club post-trade
 */
export async function proposeTrade(proposal: TradeProposal): Promise<TradeRow> {
  return withTransaction(async (client) => {
    // Validate both members exist in the league
    const [proposer, recipient] = await Promise.all([
      client.query('SELECT id FROM league_members WHERE id = $1 AND league_id = $2', [proposal.proposerId, proposal.leagueId]),
      client.query('SELECT id FROM league_members WHERE id = $1 AND league_id = $2', [proposal.recipientId, proposal.leagueId]),
    ]);
    if (proposer.rows.length === 0) throw new TradeError('Proposer not in league', 'INVALID_PROPOSER');
    if (recipient.rows.length === 0) throw new TradeError('Recipient not in league', 'INVALID_RECIPIENT');

    // Validate proposer owns all offered players
    for (const playerId of proposal.proposerOffers) {
      const r = await client.query(
        'SELECT 1 FROM rosters WHERE member_id = $1 AND player_id = $2',
        [proposal.proposerId, playerId],
      );
      if (r.rows.length === 0) {
        throw new TradeError(`Proposer doesn't own player ${playerId}`, 'PLAYER_NOT_OWNED');
      }
    }

    // Validate recipient owns all offered players
    for (const playerId of proposal.recipientOffers) {
      const r = await client.query(
        'SELECT 1 FROM rosters WHERE member_id = $1 AND player_id = $2',
        [proposal.recipientId, playerId],
      );
      if (r.rows.length === 0) {
        throw new TradeError(`Recipient doesn't own player ${playerId}`, 'PLAYER_NOT_OWNED');
      }
    }

    // Validate post-trade roster constraints for both sides
    await validatePostTradeRoster(
      client, proposal.proposerId,
      proposal.recipientOffers, // gaining
      proposal.proposerOffers,  // losing
    );
    await validatePostTradeRoster(
      client, proposal.recipientId,
      proposal.proposerOffers,  // gaining
      proposal.recipientOffers, // losing
    );

    // Get league trade review period
    const leagueResult = await client.query<{ trade_review_hours: number | null }>(
      'SELECT trade_review_hours FROM leagues WHERE id = $1',
      [proposal.leagueId],
    );
    const reviewHours = leagueResult.rows[0]?.trade_review_hours ?? 24;

    // Compute veto deadline
    const vetoDeadline = reviewHours
      ? new Date(Date.now() + reviewHours * 60 * 60 * 1000).toISOString()
      : null;

    // Create trade
    const tradeResult = await client.query<TradeRow>(
      `INSERT INTO trades (league_id, proposer_id, recipient_id, status, veto_deadline, message)
       VALUES ($1, $2, $3, 'proposed', $4, $5)
       RETURNING *`,
      [proposal.leagueId, proposal.proposerId, proposal.recipientId, vetoDeadline, proposal.message ?? null],
    );
    const trade = tradeResult.rows[0];

    // Insert trade players
    for (const playerId of proposal.proposerOffers) {
      await client.query(
        `INSERT INTO trade_players (trade_id, player_id, from_member_id, to_member_id)
         VALUES ($1, $2, $3, $4)`,
        [trade.id, playerId, proposal.proposerId, proposal.recipientId],
      );
    }
    for (const playerId of proposal.recipientOffers) {
      await client.query(
        `INSERT INTO trade_players (trade_id, player_id, from_member_id, to_member_id)
         VALUES ($1, $2, $3, $4)`,
        [trade.id, playerId, proposal.recipientId, proposal.proposerId],
      );
    }

    return trade;
  });
}

/**
 * Accept a trade proposal.
 * If no veto period, executes immediately.
 * If veto period exists, moves to 'accepted' and waits for deadline.
 */
export async function acceptTrade(tradeId: string, recipientId: string): Promise<TradeRow> {
  return withTransaction(async (client) => {
    const tradeResult = await client.query<TradeRow>(
      `SELECT * FROM trades WHERE id = $1 FOR UPDATE`,
      [tradeId],
    );
    const trade = tradeResult.rows[0];
    if (!trade) throw new TradeError('Trade not found', 'NOT_FOUND');
    if (trade.status !== 'proposed') throw new TradeError('Trade is not pending', 'INVALID_STATUS');
    if (trade.recipient_id !== recipientId) throw new TradeError('Not the recipient', 'NOT_RECIPIENT');

    if (trade.veto_deadline) {
      // Move to accepted, wait for veto period
      await client.query(
        `UPDATE trades SET status = 'accepted', resolved_at = now() WHERE id = $1`,
        [tradeId],
      );
      return { ...trade, status: 'accepted' };
    } else {
      // No review period — execute immediately
      await executeTrade(client, trade);
      await client.query(
        `UPDATE trades SET status = 'completed', resolved_at = now() WHERE id = $1`,
        [tradeId],
      );
      return { ...trade, status: 'completed' };
    }
  });
}

/**
 * Reject a trade proposal.
 */
export async function rejectTrade(tradeId: string, recipientId: string): Promise<void> {
  const result = await query(
    `UPDATE trades SET status = 'rejected', resolved_at = now()
     WHERE id = $1 AND recipient_id = $2 AND status = 'proposed'
     RETURNING id`,
    [tradeId, recipientId],
  );
  if (result.rows.length === 0) {
    throw new TradeError('Trade not found or already resolved', 'INVALID_STATUS');
  }
}

/**
 * Cancel a trade proposal (by the proposer).
 */
export async function cancelTrade(tradeId: string, proposerId: string): Promise<void> {
  const result = await query(
    `UPDATE trades SET status = 'cancelled', resolved_at = now()
     WHERE id = $1 AND proposer_id = $2 AND status = 'proposed'
     RETURNING id`,
    [tradeId, proposerId],
  );
  if (result.rows.length === 0) {
    throw new TradeError('Trade not found or already resolved', 'INVALID_STATUS');
  }
}

/**
 * Commissioner veto on an accepted trade.
 */
export async function vetoTrade(tradeId: string): Promise<void> {
  const result = await query(
    `UPDATE trades SET status = 'vetoed', resolved_at = now()
     WHERE id = $1 AND status = 'accepted'
     RETURNING id`,
    [tradeId],
  );
  if (result.rows.length === 0) {
    throw new TradeError('Trade not found or not vetoable', 'INVALID_STATUS');
  }
}

/**
 * Process accepted trades past their veto deadline.
 * Run on a schedule (e.g. every 5 minutes).
 */
export async function processExpiredVetoPeriods(): Promise<number> {
  const pendingTrades = await query<TradeRow>(
    `SELECT * FROM trades
     WHERE status = 'accepted' AND veto_deadline IS NOT NULL AND veto_deadline < now()
     FOR UPDATE SKIP LOCKED`,
  );

  let processed = 0;
  for (const trade of pendingTrades.rows) {
    try {
      await withTransaction(async (client) => {
        await executeTrade(client, trade);
        await client.query(
          `UPDATE trades SET status = 'completed', resolved_at = now() WHERE id = $1`,
          [trade.id],
        );
      });
      processed++;
    } catch (err) {
      console.error(`Failed to execute trade ${trade.id}:`, err);
      // Trade stays in 'accepted' state, will retry next cycle
    }
  }

  return processed;
}

/**
 * Cast a vote on a trade (for league-vote veto systems).
 */
export async function voteTrade(
  tradeId: string,
  memberId: string,
  approve: boolean,
): Promise<{ vetoes: number; threshold: number }> {
  await query(
    `INSERT INTO trade_votes (trade_id, member_id, approve)
     VALUES ($1, $2, $3)
     ON CONFLICT (trade_id, member_id) DO UPDATE SET approve = $3, voted_at = now()`,
    [tradeId, memberId, approve],
  );

  // Check if veto threshold reached (majority of league votes against)
  const trade = await query<TradeRow>(
    'SELECT * FROM trades WHERE id = $1',
    [tradeId],
  );
  if (trade.rows.length === 0) throw new TradeError('Trade not found', 'NOT_FOUND');

  const leagueSize = await query<{ count: string }>(
    'SELECT COUNT(*) as count FROM league_members WHERE league_id = $1',
    [trade.rows[0].league_id],
  );
  const totalMembers = parseInt(leagueSize.rows[0].count);

  // Exclude the two trade participants from voting
  const vetoThreshold = Math.ceil((totalMembers - 2) / 2);

  const vetoes = await query<{ count: string }>(
    'SELECT COUNT(*) as count FROM trade_votes WHERE trade_id = $1 AND NOT approve',
    [tradeId],
  );
  const vetoCount = parseInt(vetoes.rows[0].count);

  if (vetoCount >= vetoThreshold) {
    await query(
      `UPDATE trades SET status = 'vetoed', resolved_at = now() WHERE id = $1 AND status = 'accepted'`,
      [tradeId],
    );
  }

  return { vetoes: vetoCount, threshold: vetoThreshold };
}

// ── Internal ─────────────────────────────────────────────────────

/**
 * Execute a trade: swap roster entries and log transactions.
 */
async function executeTrade(client: pg.PoolClient, trade: TradeRow): Promise<void> {
  const playersResult = await client.query<{
    player_id: number;
    from_member_id: string;
    to_member_id: string;
  }>(
    'SELECT player_id, from_member_id, to_member_id FROM trade_players WHERE trade_id = $1',
    [trade.id],
  );

  for (const tp of playersResult.rows) {
    // Remove from source roster
    await client.query(
      'DELETE FROM rosters WHERE member_id = $1 AND player_id = $2',
      [tp.from_member_id, tp.player_id],
    );

    // Add to destination roster (bench by default)
    await client.query(
      `INSERT INTO rosters (member_id, player_id, slot) VALUES ($1, $2, 'BENCH')`,
      [tp.to_member_id, tp.player_id],
    );

    // Log transaction for the receiving side
    await client.query(
      `INSERT INTO transactions (league_id, member_id, type, player_in_id, player_out_id, source_id)
       VALUES ($1, $2, 'trade', $3, NULL, $4)`,
      [trade.league_id, tp.to_member_id, tp.player_id, trade.id],
    );
  }
}

/**
 * Validate that a member's roster remains valid after a trade.
 * Simulates the swap and checks club/positional limits.
 */
async function validatePostTradeRoster(
  client: pg.PoolClient,
  memberId: string,
  gaining: number[],
  losing: number[],
): Promise<void> {
  // Get current roster with player details
  const rosterResult = await client.query<{ player_id: number; position: string; club_code: string }>(
    `SELECT r.player_id, p.position, p.club_code
     FROM rosters r JOIN players p ON p.id = r.player_id
     WHERE r.member_id = $1`,
    [memberId],
  );

  // Get details of incoming/outgoing players
  const gainingDetails = gaining.length > 0
    ? (await client.query<{ id: number; position: string; club_code: string }>(
        `SELECT id, position, club_code FROM players WHERE id = ANY($1)`,
        [gaining],
      )).rows
    : [];

  const losingSet = new Set(losing);

  // Simulate post-trade roster
  const postRoster = [
    ...rosterResult.rows.filter((r) => !losingSet.has(r.player_id)),
    ...gainingDetails.map((p) => ({ player_id: p.id, position: p.position, club_code: p.club_code })),
  ];

  // Check squad size
  if (postRoster.length !== rosterResult.rows.length) {
    throw new TradeError(
      `Trade would change roster size from ${rosterResult.rows.length} to ${postRoster.length}`,
      'ROSTER_SIZE_MISMATCH',
    );
  }

  // Check club limits
  const clubCounts = new Map<string, number>();
  for (const p of postRoster) {
    clubCounts.set(p.club_code, (clubCounts.get(p.club_code) ?? 0) + 1);
  }
  for (const [club, count] of clubCounts) {
    if (count > 3) {
      throw new TradeError(`Trade would exceed 3-player limit for ${club}`, 'CLUB_LIMIT_EXCEEDED');
    }
  }

  // Check positional limits
  const posLimits: Record<string, number> = { GKP: 2, DEF: 5, MID: 5, FWD: 3 };
  const posCounts = new Map<string, number>();
  for (const p of postRoster) {
    posCounts.set(p.position, (posCounts.get(p.position) ?? 0) + 1);
  }
  for (const [pos, limit] of Object.entries(posLimits)) {
    if ((posCounts.get(pos) ?? 0) > limit) {
      throw new TradeError(`Trade would exceed ${pos} limit of ${limit}`, 'POSITION_LIMIT_EXCEEDED');
    }
  }
}
