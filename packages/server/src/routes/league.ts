import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query } from '../db/pool.js';

const CreateLeagueSchema = z.object({
  name: z.string().min(1).max(100),
  season: z.string().regex(/^\d{4}-\d{2}$/),
  size: z.number().int().min(4).max(16),
  draftType: z.enum(['snake', 'linear', 'auction']).default('snake'),
  faabBudget: z.number().int().min(0).default(100),
  pickTimerSeconds: z.number().int().min(30).max(600).default(120),
  waiverDeadlineDay: z.number().int().min(1).max(7).nullable().default(null),
});

const JoinLeagueSchema = z.object({
  userId: z.string().uuid(),
  teamName: z.string().min(1).max(50),
});

export async function registerLeagueRoutes(app: FastifyInstance): Promise<void> {
  // Create a league
  app.post('/api/leagues', async (req, reply) => {
    const body = CreateLeagueSchema.parse(req.body);
    // TODO: get userId from auth middleware
    const userId = (req.headers['x-user-id'] as string) ?? '';

    const result = await query(
      `INSERT INTO leagues (name, season, size, draft_type, faab_budget, waiver_deadline_day, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [body.name, body.season, body.size, body.draftType, body.faabBudget, body.waiverDeadlineDay, userId],
    );

    const league = result.rows[0];

    // Create the draft for this league
    await query(
      `INSERT INTO drafts (league_id, total_rounds, pick_timer_seconds)
       VALUES ($1, 15, $2)`,
      [league.id, body.pickTimerSeconds],
    );

    // Auto-join the creator
    await query(
      `INSERT INTO league_members (league_id, user_id, team_name, faab_remaining)
       VALUES ($1, $2, $3, $4)`,
      [league.id, userId, body.name, body.faabBudget],
    );

    return reply.code(201).send(league);
  });

  // Get a league
  app.get('/api/leagues/:leagueId', async (req, reply) => {
    const { leagueId } = z.object({ leagueId: z.string().uuid() }).parse(req.params);

    const result = await query('SELECT * FROM leagues WHERE id = $1', [leagueId]);
    if (result.rows.length === 0) {
      return reply.code(404).send({ error: 'League not found' });
    }

    const membersResult = await query(
      `SELECT lm.*, u.username FROM league_members lm
       JOIN users u ON u.id = lm.user_id
       WHERE lm.league_id = $1 ORDER BY lm.joined_at`,
      [leagueId],
    );

    return reply.send({
      ...result.rows[0],
      members: membersResult.rows,
    });
  });

  // Join a league
  app.post('/api/leagues/:leagueId/join', async (req, reply) => {
    const { leagueId } = z.object({ leagueId: z.string().uuid() }).parse(req.params);
    const body = JoinLeagueSchema.parse(req.body);

    // Check league exists and has room
    const league = await query('SELECT * FROM leagues WHERE id = $1', [leagueId]);
    if (league.rows.length === 0) {
      return reply.code(404).send({ error: 'League not found' });
    }

    const memberCount = await query(
      'SELECT COUNT(*) as count FROM league_members WHERE league_id = $1',
      [leagueId],
    );
    if (parseInt(memberCount.rows[0].count) >= league.rows[0].size) {
      return reply.code(400).send({ error: 'League is full' });
    }

    const result = await query(
      `INSERT INTO league_members (league_id, user_id, team_name, faab_remaining)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [leagueId, body.userId, body.teamName, league.rows[0].faab_budget],
    );

    return reply.code(201).send(result.rows[0]);
  });

  // Set draft seeds (commissioner action, before draft)
  app.post('/api/leagues/:leagueId/seeds', async (req, reply) => {
    const { leagueId } = z.object({ leagueId: z.string().uuid() }).parse(req.params);
    const body = z.object({
      seeds: z.array(z.object({
        memberId: z.string().uuid(),
        seed: z.number().int().positive(),
      })),
    }).parse(req.body);

    for (const { memberId, seed } of body.seeds) {
      await query(
        `UPDATE league_members SET draft_seed = $3 WHERE id = $1 AND league_id = $2`,
        [memberId, leagueId, seed],
      );
    }

    // Initialize waiver priority (inverse of draft seed)
    const members = await query(
      `SELECT id, draft_seed FROM league_members WHERE league_id = $1 ORDER BY draft_seed DESC`,
      [leagueId],
    );
    for (let i = 0; i < members.rows.length; i++) {
      await query(
        `INSERT INTO waiver_priority (league_id, member_id, priority)
         VALUES ($1, $2, $3)
         ON CONFLICT (league_id, member_id)
         DO UPDATE SET priority = $3`,
        [leagueId, members.rows[i].id, i + 1],
      );
    }

    return reply.send({ ok: true });
  });

  // Get roster for a member
  app.get('/api/leagues/:leagueId/members/:memberId/roster', async (req, reply) => {
    const params = z.object({
      leagueId: z.string().uuid(),
      memberId: z.string().uuid(),
    }).parse(req.params);

    const result = await query(
      `SELECT r.*, p.web_name, p.position, p.club_code, p.now_cost, p.total_points
       FROM rosters r
       JOIN players p ON p.id = r.player_id
       WHERE r.member_id = $1
       ORDER BY
         CASE r.slot WHEN 'GKP' THEN 1 WHEN 'DEF' THEN 2 WHEN 'MID' THEN 3 WHEN 'FWD' THEN 4 WHEN 'BENCH' THEN 5 END,
         r.bench_order NULLS LAST`,
      [params.memberId],
    );

    return reply.send(result.rows);
  });

  // Get league standings
  app.get('/api/leagues/:leagueId/standings', async (req, reply) => {
    const { leagueId } = z.object({ leagueId: z.string().uuid() }).parse(req.params);
    const { gameweek } = z.object({ gameweek: z.coerce.number().int().optional() }).parse(req.query);

    let result;
    if (gameweek) {
      result = await query(
        `SELECT ls.*, lm.team_name, u.username
         FROM league_standings ls
         JOIN league_members lm ON lm.id = ls.member_id
         JOIN users u ON u.id = lm.user_id
         WHERE ls.league_id = $1 AND ls.gameweek = $2
         ORDER BY ls.rank`,
        [leagueId, gameweek],
      );
    } else {
      // Latest gameweek
      result = await query(
        `SELECT ls.*, lm.team_name, u.username
         FROM league_standings ls
         JOIN league_members lm ON lm.id = ls.member_id
         JOIN users u ON u.id = lm.user_id
         WHERE ls.league_id = $1
           AND ls.gameweek = (SELECT MAX(gameweek) FROM league_standings WHERE league_id = $1)
         ORDER BY ls.rank`,
        [leagueId],
      );
    }

    return reply.send(result.rows);
  });
}
