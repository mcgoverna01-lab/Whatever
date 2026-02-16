import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query } from '../db/pool.js';

const SubmitWaiverSchema = z.object({
  memberId: z.string().uuid(),
  claims: z.array(z.object({
    playerInId: z.number().int().positive(),
    playerOutId: z.number().int().positive(),
    priority: z.number().int().positive(),
  })).min(1),
});

const SubmitFaabSchema = z.object({
  memberId: z.string().uuid(),
  bids: z.array(z.object({
    playerInId: z.number().int().positive(),
    playerOutId: z.number().int().positive(),
    amount: z.number().int().min(0),
  })).min(1),
});

export async function registerWaiverRoutes(app: FastifyInstance): Promise<void> {
  // Submit waiver claims
  app.post('/api/leagues/:leagueId/waivers', async (req, reply) => {
    const { leagueId } = z.object({ leagueId: z.string().uuid() }).parse(req.params);
    const { gameweek } = z.object({ gameweek: z.coerce.number().int() }).parse(req.query);
    const body = SubmitWaiverSchema.parse(req.body);

    // Cancel any existing pending claims for this member/gameweek
    await query(
      `UPDATE waiver_claims SET status = 'cancelled'
       WHERE league_id = $1 AND member_id = $2 AND gameweek = $3 AND status = 'pending'`,
      [leagueId, body.memberId, gameweek],
    );

    // Insert new claims
    const claims = [];
    for (const claim of body.claims) {
      const result = await query(
        `INSERT INTO waiver_claims (league_id, member_id, gameweek, player_in_id, player_out_id, priority)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [leagueId, body.memberId, gameweek, claim.playerInId, claim.playerOutId, claim.priority],
      );
      claims.push(result.rows[0]);
    }

    return reply.code(201).send(claims);
  });

  // Get pending waiver claims for a member
  app.get('/api/leagues/:leagueId/waivers', async (req, reply) => {
    const { leagueId } = z.object({ leagueId: z.string().uuid() }).parse(req.params);
    const { memberId, gameweek } = z.object({
      memberId: z.string().uuid(),
      gameweek: z.coerce.number().int(),
    }).parse(req.query);

    const result = await query(
      `SELECT wc.*, pin.web_name as player_in_name, pout.web_name as player_out_name
       FROM waiver_claims wc
       JOIN players pin ON pin.id = wc.player_in_id
       JOIN players pout ON pout.id = wc.player_out_id
       WHERE wc.league_id = $1 AND wc.member_id = $2 AND wc.gameweek = $3
       ORDER BY wc.priority`,
      [leagueId, memberId, gameweek],
    );

    return reply.send(result.rows);
  });

  // Submit FAAB bids
  app.post('/api/leagues/:leagueId/faab', async (req, reply) => {
    const { leagueId } = z.object({ leagueId: z.string().uuid() }).parse(req.params);
    const { gameweek } = z.object({ gameweek: z.coerce.number().int() }).parse(req.query);
    const body = SubmitFaabSchema.parse(req.body);

    // Validate total bid amount doesn't exceed FAAB remaining
    const memberResult = await query(
      `SELECT faab_remaining FROM league_members WHERE id = $1 AND league_id = $2`,
      [body.memberId, leagueId],
    );
    if (memberResult.rows.length === 0) {
      return reply.code(404).send({ error: 'Member not found' });
    }

    const totalBids = body.bids.reduce((sum, b) => sum + b.amount, 0);
    if (totalBids > memberResult.rows[0].faab_remaining) {
      return reply.code(400).send({
        error: 'Total bids exceed FAAB budget',
        faabRemaining: memberResult.rows[0].faab_remaining,
      });
    }

    // Cancel existing pending bids
    await query(
      `UPDATE faab_bids SET status = 'cancelled'
       WHERE league_id = $1 AND member_id = $2 AND gameweek = $3 AND status = 'pending'`,
      [leagueId, body.memberId, gameweek],
    );

    // Insert new bids
    const bids = [];
    for (const bid of body.bids) {
      const result = await query(
        `INSERT INTO faab_bids (league_id, member_id, gameweek, player_in_id, player_out_id, amount)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [leagueId, body.memberId, gameweek, bid.playerInId, bid.playerOutId, bid.amount],
      );
      bids.push(result.rows[0]);
    }

    return reply.code(201).send(bids);
  });

  // Get transaction history
  app.get('/api/leagues/:leagueId/transactions', async (req, reply) => {
    const { leagueId } = z.object({ leagueId: z.string().uuid() }).parse(req.params);
    const { limit, offset } = z.object({
      limit: z.coerce.number().int().min(1).max(100).default(50),
      offset: z.coerce.number().int().min(0).default(0),
    }).parse(req.query);

    const result = await query(
      `SELECT t.*, lm.team_name, pin.web_name as player_in_name, pout.web_name as player_out_name
       FROM transactions t
       JOIN league_members lm ON lm.id = t.member_id
       JOIN players pin ON pin.id = t.player_in_id
       LEFT JOIN players pout ON pout.id = t.player_out_id
       WHERE t.league_id = $1
       ORDER BY t.created_at DESC
       LIMIT $2 OFFSET $3`,
      [leagueId, limit, offset],
    );

    return reply.send(result.rows);
  });

  // Get waiver priority order
  app.get('/api/leagues/:leagueId/waiver-priority', async (req, reply) => {
    const { leagueId } = z.object({ leagueId: z.string().uuid() }).parse(req.params);

    const result = await query(
      `SELECT wp.*, lm.team_name
       FROM waiver_priority wp
       JOIN league_members lm ON lm.id = wp.member_id
       WHERE wp.league_id = $1
       ORDER BY wp.priority`,
      [leagueId],
    );

    return reply.send(result.rows);
  });
}
