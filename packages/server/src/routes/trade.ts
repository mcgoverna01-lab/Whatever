import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { authenticate, requireCommissioner } from '../auth/index.js';
import {
  proposeTrade,
  acceptTrade,
  rejectTrade,
  cancelTrade,
  vetoTrade,
  voteTrade,
  TradeError,
} from '../trades/index.js';

const ProposeTradeSchema = z.object({
  recipientId: z.string().uuid(),
  proposerOffers: z.array(z.number().int().positive()).min(1).max(5),
  recipientOffers: z.array(z.number().int().positive()).min(1).max(5),
  message: z.string().max(500).optional(),
});

export async function registerTradeRoutes(app: FastifyInstance): Promise<void> {
  // Propose a trade
  app.post('/api/leagues/:leagueId/trades', {
    preHandler: authenticate,
  }, async (req, reply) => {
    const { leagueId } = z.object({ leagueId: z.string().uuid() }).parse(req.params);
    const body = ProposeTradeSchema.parse(req.body);

    // Resolve proposerId from auth token
    const memberResult = await query(
      'SELECT id FROM league_members WHERE league_id = $1 AND user_id = $2',
      [leagueId, req.user!.sub],
    );
    if (memberResult.rows.length === 0) {
      return reply.code(403).send({ error: 'Not a member of this league' });
    }
    const proposerId = memberResult.rows[0].id;

    try {
      const trade = await proposeTrade({
        leagueId,
        proposerId,
        recipientId: body.recipientId,
        proposerOffers: body.proposerOffers,
        recipientOffers: body.recipientOffers,
        message: body.message,
      });

      // Fetch trade details for response
      const details = await getTradeDetails(trade.id);
      return reply.code(201).send(details);
    } catch (err) {
      if (err instanceof TradeError) {
        return reply.code(400).send({ error: err.code, message: err.message });
      }
      throw err;
    }
  });

  // Get trades for a league
  app.get('/api/leagues/:leagueId/trades', async (req, reply) => {
    const { leagueId } = z.object({ leagueId: z.string().uuid() }).parse(req.params);
    const qs = z.object({
      status: z.enum(['proposed', 'accepted', 'vetoed', 'rejected', 'cancelled', 'completed']).optional(),
      limit: z.coerce.number().int().min(1).max(100).default(50),
      offset: z.coerce.number().int().min(0).default(0),
    }).parse(req.query);

    let statusFilter = '';
    const params: unknown[] = [leagueId, qs.limit, qs.offset];
    if (qs.status) {
      statusFilter = 'AND t.status = $4';
      params.push(qs.status);
    }

    const result = await query(
      `SELECT t.*,
        prop_lm.team_name as proposer_team,
        recip_lm.team_name as recipient_team
       FROM trades t
       JOIN league_members prop_lm ON prop_lm.id = t.proposer_id
       JOIN league_members recip_lm ON recip_lm.id = t.recipient_id
       WHERE t.league_id = $1 ${statusFilter}
       ORDER BY t.proposed_at DESC
       LIMIT $2 OFFSET $3`,
      params,
    );

    // Attach players for each trade
    const trades = await Promise.all(
      result.rows.map(async (trade: any) => {
        const players = await query(
          `SELECT tp.*, p.web_name, p.position, p.club_code
           FROM trade_players tp JOIN players p ON p.id = tp.player_id
           WHERE tp.trade_id = $1`,
          [trade.id],
        );
        return { ...trade, players: players.rows };
      }),
    );

    return reply.send(trades);
  });

  // Accept a trade
  app.post('/api/trades/:tradeId/accept', {
    preHandler: authenticate,
  }, async (req, reply) => {
    const { tradeId } = z.object({ tradeId: z.string().uuid() }).parse(req.params);

    // Resolve member ID
    const trade = await query('SELECT * FROM trades WHERE id = $1', [tradeId]);
    if (trade.rows.length === 0) {
      return reply.code(404).send({ error: 'Trade not found' });
    }

    const memberResult = await query(
      'SELECT id FROM league_members WHERE id = $1 AND user_id = $2',
      [trade.rows[0].recipient_id, req.user!.sub],
    );
    if (memberResult.rows.length === 0) {
      return reply.code(403).send({ error: 'Not the trade recipient' });
    }

    try {
      const updated = await acceptTrade(tradeId, memberResult.rows[0].id);
      return reply.send(updated);
    } catch (err) {
      if (err instanceof TradeError) {
        return reply.code(400).send({ error: err.code, message: err.message });
      }
      throw err;
    }
  });

  // Reject a trade
  app.post('/api/trades/:tradeId/reject', {
    preHandler: authenticate,
  }, async (req, reply) => {
    const { tradeId } = z.object({ tradeId: z.string().uuid() }).parse(req.params);

    const trade = await query('SELECT * FROM trades WHERE id = $1', [tradeId]);
    if (trade.rows.length === 0) {
      return reply.code(404).send({ error: 'Trade not found' });
    }

    const memberResult = await query(
      'SELECT id FROM league_members WHERE id = $1 AND user_id = $2',
      [trade.rows[0].recipient_id, req.user!.sub],
    );
    if (memberResult.rows.length === 0) {
      return reply.code(403).send({ error: 'Not the trade recipient' });
    }

    try {
      await rejectTrade(tradeId, memberResult.rows[0].id);
      return reply.send({ ok: true });
    } catch (err) {
      if (err instanceof TradeError) {
        return reply.code(400).send({ error: err.code, message: err.message });
      }
      throw err;
    }
  });

  // Cancel a trade (proposer only)
  app.post('/api/trades/:tradeId/cancel', {
    preHandler: authenticate,
  }, async (req, reply) => {
    const { tradeId } = z.object({ tradeId: z.string().uuid() }).parse(req.params);

    const trade = await query('SELECT * FROM trades WHERE id = $1', [tradeId]);
    if (trade.rows.length === 0) {
      return reply.code(404).send({ error: 'Trade not found' });
    }

    const memberResult = await query(
      'SELECT id FROM league_members WHERE id = $1 AND user_id = $2',
      [trade.rows[0].proposer_id, req.user!.sub],
    );
    if (memberResult.rows.length === 0) {
      return reply.code(403).send({ error: 'Not the trade proposer' });
    }

    try {
      await cancelTrade(tradeId, memberResult.rows[0].id);
      return reply.send({ ok: true });
    } catch (err) {
      if (err instanceof TradeError) {
        return reply.code(400).send({ error: err.code, message: err.message });
      }
      throw err;
    }
  });

  // Commissioner veto
  app.post('/api/trades/:tradeId/veto', {
    preHandler: authenticate,
    // requireCommissioner is checked inline — need to get leagueId from trade
  }, async (req, reply) => {
    const { tradeId } = z.object({ tradeId: z.string().uuid() }).parse(req.params);

    const trade = await query('SELECT * FROM trades WHERE id = $1', [tradeId]);
    if (trade.rows.length === 0) {
      return reply.code(404).send({ error: 'Trade not found' });
    }

    // Check commissioner
    const league = await query('SELECT created_by FROM leagues WHERE id = $1', [trade.rows[0].league_id]);
    if (league.rows[0].created_by !== req.user!.sub) {
      return reply.code(403).send({ error: 'Commissioner access required' });
    }

    try {
      await vetoTrade(tradeId);
      return reply.send({ ok: true });
    } catch (err) {
      if (err instanceof TradeError) {
        return reply.code(400).send({ error: err.code, message: err.message });
      }
      throw err;
    }
  });

  // League member vote on trade
  app.post('/api/trades/:tradeId/vote', {
    preHandler: authenticate,
  }, async (req, reply) => {
    const { tradeId } = z.object({ tradeId: z.string().uuid() }).parse(req.params);
    const { approve } = z.object({ approve: z.boolean() }).parse(req.body);

    const trade = await query('SELECT league_id FROM trades WHERE id = $1', [tradeId]);
    if (trade.rows.length === 0) {
      return reply.code(404).send({ error: 'Trade not found' });
    }

    const memberResult = await query(
      'SELECT id FROM league_members WHERE league_id = $1 AND user_id = $2',
      [trade.rows[0].league_id, req.user!.sub],
    );
    if (memberResult.rows.length === 0) {
      return reply.code(403).send({ error: 'Not a member of this league' });
    }

    try {
      const result = await voteTrade(tradeId, memberResult.rows[0].id, approve);
      return reply.send(result);
    } catch (err) {
      if (err instanceof TradeError) {
        return reply.code(400).send({ error: err.code, message: err.message });
      }
      throw err;
    }
  });
}

async function getTradeDetails(tradeId: string) {
  const [trade, players] = await Promise.all([
    query(
      `SELECT t.*,
        prop_lm.team_name as proposer_team,
        recip_lm.team_name as recipient_team
       FROM trades t
       JOIN league_members prop_lm ON prop_lm.id = t.proposer_id
       JOIN league_members recip_lm ON recip_lm.id = t.recipient_id
       WHERE t.id = $1`,
      [tradeId],
    ),
    query(
      `SELECT tp.*, p.web_name, p.position, p.club_code
       FROM trade_players tp JOIN players p ON p.id = tp.player_id
       WHERE tp.trade_id = $1`,
      [tradeId],
    ),
  ]);

  return { ...trade.rows[0], players: players.rows };
}
