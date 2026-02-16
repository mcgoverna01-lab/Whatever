import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query } from '../db/pool.js';

export async function registerPlayerRoutes(app: FastifyInstance): Promise<void> {
  // Get all players (for draft board, player search, etc.)
  app.get('/api/players', async (req, reply) => {
    const qs = z.object({
      position: z.enum(['GKP', 'DEF', 'MID', 'FWD']).optional(),
      club: z.string().max(5).optional(),
      search: z.string().max(100).optional(),
      sortBy: z.enum(['total_points', 'now_cost', 'points_per_game', 'web_name', 'minutes']).default('total_points'),
      order: z.enum(['asc', 'desc']).default('desc'),
      limit: z.coerce.number().int().min(1).max(500).default(200),
      offset: z.coerce.number().int().min(0).default(0),
    }).parse(req.query);

    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;

    if (qs.position) {
      conditions.push(`p.position = $${paramIdx++}`);
      params.push(qs.position);
    }
    if (qs.club) {
      conditions.push(`p.club_code = $${paramIdx++}`);
      params.push(qs.club);
    }
    if (qs.search) {
      conditions.push(`(p.web_name ILIKE $${paramIdx} OR p.first_name ILIKE $${paramIdx} OR p.last_name ILIKE $${paramIdx})`);
      params.push(`%${qs.search}%`);
      paramIdx++;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Allowlisted sort columns — safe from injection
    const sortCol = qs.sortBy;
    const sortDir = qs.order === 'asc' ? 'ASC' : 'DESC';

    const result = await query(
      `SELECT
        p.id, p.fpl_id, p.web_name, p.first_name, p.last_name,
        p.position, p.club_code, p.club_name, p.now_cost,
        p.total_points, p.points_per_game, p.minutes,
        p.available, p.news, p.chance_of_playing_next_round
       FROM players p
       ${where}
       ORDER BY p.${sortCol} ${sortDir}
       LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
      [...params, qs.limit, qs.offset],
    );

    // Also return total count for pagination
    const countResult = await query(
      `SELECT COUNT(*) as total FROM players p ${where}`,
      params,
    );

    return reply.send({
      players: result.rows.map(mapPlayerRow),
      total: parseInt(countResult.rows[0].total),
    });
  });

  // Get single player with recent gameweek stats
  app.get('/api/players/:playerId', async (req, reply) => {
    const { playerId } = z.object({ playerId: z.coerce.number().int() }).parse(req.params);

    const [playerResult, statsResult] = await Promise.all([
      query('SELECT * FROM players WHERE id = $1', [playerId]),
      query(
        `SELECT * FROM gameweek_stats WHERE player_id = $1 ORDER BY gameweek DESC LIMIT 10`,
        [playerId],
      ),
    ]);

    if (playerResult.rows.length === 0) {
      return reply.code(404).send({ error: 'Player not found' });
    }

    return reply.send({
      ...mapPlayerRow(playerResult.rows[0]),
      recentStats: statsResult.rows,
    });
  });

  // Get available (undrafted) players for a specific draft
  app.get('/api/drafts/:draftId/available-players', async (req, reply) => {
    const { draftId } = z.object({ draftId: z.string().uuid() }).parse(req.params);
    const qs = z.object({
      position: z.enum(['GKP', 'DEF', 'MID', 'FWD']).optional(),
      search: z.string().max(100).optional(),
      limit: z.coerce.number().int().min(1).max(500).default(200),
      offset: z.coerce.number().int().min(0).default(0),
    }).parse(req.query);

    const conditions: string[] = [
      `p.id NOT IN (SELECT player_id FROM draft_queue WHERE draft_id = $1 AND player_id IS NOT NULL)`,
    ];
    const params: unknown[] = [draftId];
    let paramIdx = 2;

    if (qs.position) {
      conditions.push(`p.position = $${paramIdx++}`);
      params.push(qs.position);
    }
    if (qs.search) {
      conditions.push(`(p.web_name ILIKE $${paramIdx} OR p.club_code ILIKE $${paramIdx})`);
      params.push(`%${qs.search}%`);
      paramIdx++;
    }

    const result = await query(
      `SELECT
        p.id, p.fpl_id, p.web_name, p.first_name, p.last_name,
        p.position, p.club_code, p.club_name, p.now_cost,
        p.total_points, p.points_per_game, p.minutes,
        p.available, p.news, p.chance_of_playing_next_round
       FROM players p
       WHERE ${conditions.join(' AND ')}
       ORDER BY p.total_points DESC
       LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
      [...params, qs.limit, qs.offset],
    );

    return reply.send({
      players: result.rows.map(mapPlayerRow),
    });
  });

  // Free agents for a league (not on any roster in this league)
  app.get('/api/leagues/:leagueId/free-agents', async (req, reply) => {
    const { leagueId } = z.object({ leagueId: z.string().uuid() }).parse(req.params);
    const qs = z.object({
      position: z.enum(['GKP', 'DEF', 'MID', 'FWD']).optional(),
      search: z.string().max(100).optional(),
      limit: z.coerce.number().int().min(1).max(500).default(100),
      offset: z.coerce.number().int().min(0).default(0),
    }).parse(req.query);

    const conditions: string[] = [
      `p.id NOT IN (
         SELECT r.player_id FROM rosters r
         JOIN league_members lm ON lm.id = r.member_id
         WHERE lm.league_id = $1
       )`,
    ];
    const params: unknown[] = [leagueId];
    let paramIdx = 2;

    if (qs.position) {
      conditions.push(`p.position = $${paramIdx++}`);
      params.push(qs.position);
    }
    if (qs.search) {
      conditions.push(`(p.web_name ILIKE $${paramIdx})`);
      params.push(`%${qs.search}%`);
      paramIdx++;
    }

    const result = await query(
      `SELECT
        p.id, p.fpl_id, p.web_name, p.first_name, p.last_name,
        p.position, p.club_code, p.club_name, p.now_cost,
        p.total_points, p.points_per_game, p.minutes,
        p.available, p.news, p.chance_of_playing_next_round
       FROM players p
       WHERE ${conditions.join(' AND ')}
       ORDER BY p.total_points DESC
       LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
      [...params, qs.limit, qs.offset],
    );

    return reply.send({
      players: result.rows.map(mapPlayerRow),
    });
  });
}

function mapPlayerRow(row: any) {
  return {
    id: row.id,
    fplId: row.fpl_id,
    webName: row.web_name,
    firstName: row.first_name,
    lastName: row.last_name,
    position: row.position,
    clubCode: row.club_code,
    clubName: row.club_name,
    nowCost: row.now_cost,
    totalPoints: row.total_points,
    pointsPerGame: parseFloat(row.points_per_game),
    minutes: row.minutes,
    available: row.available,
    news: row.news,
    chanceOfPlayingNextRound: row.chance_of_playing_next_round,
  };
}
