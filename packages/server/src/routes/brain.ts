import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { fpl, createEngine, evaluateTrade, recommendWaivers, adviseFaab } from '../brain/index.js';
import { projectionTracker } from '../brain/projection/tracker.js';
import { query } from '../db/pool.js';
import type { BrainRoster, ProjectionContext } from '../brain/types.js';

const engine = createEngine(process.env.PROJECTION_ENGINE ?? 'heuristic');

/**
 * Brain routes — the FPL intelligence layer.
 *
 * All endpoints use the FPL API for player data and projections.
 * Rosters are loaded from the DB (users connect their league first).
 *
 * GET  /api/brain/context                      → Current FPL context (GW, player count)
 * POST /api/brain/trade/evaluate               → Evaluate a trade proposal
 * GET  /api/brain/waiver/:leagueId/:memberId   → Waiver recommendations
 * GET  /api/brain/faab/:leagueId/:memberId     → FAAB budget advice
 * POST /api/brain/project/:playerId            → Single player projection
 */
export async function registerBrainRoutes(app: FastifyInstance): Promise<void> {

  // ── FPL context / health check ──────────────────────────────

  app.get('/api/brain/context', async (_req, reply) => {
    const ctx = await fpl.buildContext();

    return reply.send({
      engine: engine.name,
      currentGameweek: ctx.currentGameweek,
      totalGameweeks: ctx.totalGameweeks,
      playerCount: ctx.players.size,
      clubCount: ctx.clubs.size,
      fixtureCount: ctx.fixtures.length,
    });
  });

  // ── Single player projection ──────────────────────────────────

  app.post('/api/brain/project/:playerId', async (req, reply) => {
    const { playerId } = z.object({
      playerId: z.coerce.number().int().positive(),
    }).parse(req.params);

    const ctx = await fpl.buildContext();
    const projection = engine.projectPlayer(playerId, ctx);

    return reply.send({ ...projection, engine: engine.name });
  });

  // ── Trade evaluator ─────────────────────────────────────────

  const TradeBody = z.object({
    leagueId: z.string().uuid(),
    memberIdA: z.string().uuid(),
    memberIdB: z.string().uuid(),
    sendPlayerIds: z.array(z.number().int().positive()).min(1).max(10),
    receivePlayerIds: z.array(z.number().int().positive()).min(1).max(10),
  });

  app.post('/api/brain/trade/evaluate', async (req, reply) => {
    const body = TradeBody.parse(req.body);
    const ctx = await fpl.buildContext();

    const allRosters = await loadLeagueRosters(body.leagueId, ctx);
    const rosterA = allRosters.find((r) => r.memberId === body.memberIdA);
    const rosterB = allRosters.find((r) => r.memberId === body.memberIdB);

    if (!rosterA || !rosterB) {
      return reply.code(404).send({ error: 'One or both rosters not found' });
    }

    const result = evaluateTrade(
      {
        rosterA,
        rosterB,
        sendPlayerIds: body.sendPlayerIds,
        receivePlayerIds: body.receivePlayerIds,
      },
      engine,
      ctx,
    );

    return reply.send({ ...result, engine: engine.name });
  });

  // ── Waiver recommendations ──────────────────────────────────

  app.get('/api/brain/waiver/:leagueId/:memberId', async (req, reply) => {
    const params = z.object({
      leagueId: z.string().uuid(),
      memberId: z.string().uuid(),
    }).parse(req.params);

    const qs = z.object({
      limit: z.coerce.number().int().min(1).max(50).default(10),
    }).parse(req.query);

    const ctx = await fpl.buildContext();
    const allRosters = await loadLeagueRosters(params.leagueId, ctx);
    const roster = allRosters.find((r) => r.memberId === params.memberId);

    if (!roster) {
      return reply.code(404).send({ error: 'Roster not found for this member' });
    }

    const result = recommendWaivers(
      { roster, allRosters, limit: qs.limit },
      engine,
      ctx,
    );

    // Save to brain history
    await saveBrainResult(params.leagueId, params.memberId, 'waiver', ctx.currentGameweek, result);

    return reply.send({ ...result, engine: engine.name });
  });

  // ── FAAB advisor ────────────────────────────────────────────

  app.get('/api/brain/faab/:leagueId/:memberId', async (req, reply) => {
    const params = z.object({
      leagueId: z.string().uuid(),
      memberId: z.string().uuid(),
    }).parse(req.params);

    const qs = z.object({
      limit: z.coerce.number().int().min(1).max(20).default(5),
    }).parse(req.query);

    const ctx = await fpl.buildContext();
    const allRosters = await loadLeagueRosters(params.leagueId, ctx);
    const roster = allRosters.find((r) => r.memberId === params.memberId);

    if (!roster) {
      return reply.code(404).send({ error: 'Roster not found for this member' });
    }

    const totalBudget = 100; // FPL draft standard FAAB budget

    const result = adviseFaab(
      { roster, allRosters, totalBudget, limit: qs.limit },
      engine,
      ctx,
    );

    await saveBrainResult(params.leagueId, params.memberId, 'faab', ctx.currentGameweek, result);

    return reply.send({ ...result, engine: engine.name });
  });

  // ── Projection accuracy ───────────────────────────────────────

  /**
   * GET /api/brain/accuracy/:engineName
   * Accuracy report for the given engine over the last N gameweeks.
   * engineName: 'heuristic' | 'ai' | 'compare'
   */
  app.get('/api/brain/accuracy/:engineName', async (req, reply) => {
    const { engineName } = z.object({
      engineName: z.enum(['heuristic', 'ai', 'compare']),
    }).parse(req.params);

    const qs = z.object({
      gameweeks: z.coerce.number().int().min(1).max(38).default(10),
    }).parse(req.query);

    if (engineName === 'compare') {
      const comparison = await projectionTracker.compareEngines(qs.gameweeks);
      return reply.send(comparison);
    }

    const report = await projectionTracker.getAccuracyReport(engineName, qs.gameweeks);
    return reply.send(report);
  });

  /**
   * POST /api/brain/accuracy/snapshot
   * Save projection snapshot for the current gameweek.
   * Call this before each GW deadline to start tracking accuracy.
   */
  app.post('/api/brain/accuracy/snapshot', async (_req, reply) => {
    await projectionTracker.ensureTable();
    const ctx = await fpl.buildContext();

    // Snapshot for both engines
    const [hSaved, aiSaved] = await Promise.all([
      projectionTracker.saveSnapshot(createEngine('heuristic'), ctx),
      projectionTracker.saveSnapshot(createEngine('ai'), ctx),
    ]);

    return reply.send({
      gameweek: ctx.currentGameweek,
      heuristicSaved: hSaved,
      aiSaved,
      message: `Snapshot saved for GW${ctx.currentGameweek}`,
    });
  });

  /**
   * POST /api/brain/accuracy/record-actuals/:gameweek
   * Record actual scores for a completed gameweek.
   * Call this after each GW's bonus points are applied.
   */
  app.post('/api/brain/accuracy/record-actuals/:gameweek', async (req, reply) => {
    const { gameweek } = z.object({
      gameweek: z.coerce.number().int().min(1).max(38),
    }).parse(req.params);

    await projectionTracker.ensureTable();
    const ctx = await fpl.buildContext();
    const updated = await projectionTracker.recordActuals(ctx, gameweek);

    return reply.send({
      gameweek,
      updated,
      message: `Recorded actuals for ${updated} players in GW${gameweek}`,
    });
  });

  // ── Brain history ─────────────────────────────────────────────

  app.get('/api/brain/history/:leagueId/:memberId', async (req, reply) => {
    const params = z.object({
      leagueId: z.string().uuid(),
      memberId: z.string().uuid(),
    }).parse(req.params);

    const qs = z.object({
      type: z.enum(['waiver', 'faab', 'trade']).optional(),
      limit: z.coerce.number().int().min(1).max(50).default(20),
    }).parse(req.query);

    let typeFilter = '';
    const qParams: unknown[] = [params.leagueId, params.memberId, qs.limit];
    if (qs.type) {
      typeFilter = 'AND result_type = $4';
      qParams.push(qs.type);
    }

    const result = await query(
      `SELECT id, result_type, gameweek, result, created_at
       FROM brain_results
       WHERE league_id = $1 AND member_id = $2 ${typeFilter}
       ORDER BY created_at DESC
       LIMIT $3`,
      qParams,
    );

    return reply.send(result.rows);
  });
}

// ── Shared helpers ────────────────────────────────────────────

/**
 * Load all rosters for a league from the DB and convert to BrainRoster format.
 * Each roster is a league_member with their rostered player FPL IDs.
 */
async function loadLeagueRosters(
  leagueId: string,
  _ctx: ProjectionContext,
): Promise<BrainRoster[]> {
  const members = await query(
    `SELECT lm.id, lm.team_name,
            COALESCE(
              (SELECT json_agg(rs.player_id)
               FROM roster_slots rs WHERE rs.member_id = lm.id),
              '[]'::json
            ) AS player_ids,
            COALESCE(lm.faab_remaining, 100) AS faab_remaining
     FROM league_members lm
     WHERE lm.league_id = $1`,
    [leagueId],
  );

  return members.rows.map((row: any) => ({
    memberId: row.id,
    teamName: row.team_name ?? 'Unknown',
    playerIds: Array.isArray(row.player_ids) ? row.player_ids : JSON.parse(row.player_ids ?? '[]'),
    faabRemaining: row.faab_remaining ?? 100,
  }));
}

/**
 * Save a brain result (waiver/faab/trade analysis) for history tracking.
 */
async function saveBrainResult(
  leagueId: string,
  memberId: string,
  resultType: string,
  gameweek: number,
  result: unknown,
): Promise<void> {
  try {
    await query(
      `INSERT INTO brain_results (league_id, member_id, result_type, gameweek, result)
       VALUES ($1, $2, $3, $4, $5)`,
      [leagueId, memberId, resultType, gameweek, JSON.stringify(result)],
    );
  } catch {
    // Non-critical — don't fail the request if history save fails
    // (table might not exist yet if migration hasn't run)
  }
}
