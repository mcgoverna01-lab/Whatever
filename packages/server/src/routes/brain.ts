import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  sleeper,
  SleeperClient,
  createEngine,
  evaluateTrade,
  recommendWaivers,
  adviseFaab,
} from '../brain/index.js';
import type { ProjectionContext } from '../brain/types.js';

const engine = createEngine(process.env.PROJECTION_ENGINE ?? 'heuristic');

/**
 * Brain routes — the intelligence layer.
 *
 * All endpoints take a Sleeper league ID and work against live Sleeper data.
 * No database required — everything is fetched from Sleeper and computed on the fly.
 *
 * GET  /api/brain/league/:leagueId             → League overview with enriched rosters
 * POST /api/brain/trade/evaluate               → Evaluate a trade proposal
 * GET  /api/brain/waiver/:leagueId/:rosterId   → Waiver recommendations
 * GET  /api/brain/faab/:leagueId/:rosterId     → FAAB budget advice
 */
export async function registerBrainRoutes(app: FastifyInstance): Promise<void> {

  // ── League overview ─────────────────────────────────────────

  app.get('/api/brain/league/:leagueId', async (req, reply) => {
    const { leagueId } = z.object({ leagueId: z.string().min(1) }).parse(req.params);

    const [league, rosters, users] = await Promise.all([
      sleeper.getLeague(leagueId),
      sleeper.getRosters(leagueId),
      sleeper.getUsers(leagueId),
    ]);

    const userMap = new Map(users.map((u) => [u.user_id, u]));

    const enrichedRosters = rosters.map((r) => {
      const user = userMap.get(r.owner_id);
      return {
        rosterId: r.roster_id,
        ownerId: r.owner_id,
        ownerName: user?.display_name ?? 'Unknown',
        playerCount: r.players?.length ?? 0,
        record: `${r.settings.wins}-${r.settings.losses}${r.settings.ties ? `-${r.settings.ties}` : ''}`,
        fpts: r.settings.fpts + (r.settings.fpts_decimal ?? 0) / 100,
        faabUsed: r.settings.waiver_budget_used ?? 0,
        faabRemaining: (league.settings.waiver_budget || 100) - (r.settings.waiver_budget_used ?? 0),
      };
    });

    return reply.send({
      leagueId: league.league_id,
      name: league.name,
      season: league.season,
      totalRosters: league.total_rosters,
      status: league.status,
      rosterPositions: league.roster_positions,
      scoringType: detectScoringType(league.scoring_settings),
      rosters: enrichedRosters,
      engine: engine.name,
    });
  });

  // ── Trade evaluator ─────────────────────────────────────────

  const TradeBody = z.object({
    leagueId: z.string().min(1),
    rosterIdA: z.number().int().positive(),
    rosterIdB: z.number().int().positive(),
    sendPlayerIds: z.array(z.string().min(1)).min(1).max(10),
    receivePlayerIds: z.array(z.string().min(1)).min(1).max(10),
  });

  app.post('/api/brain/trade/evaluate', async (req, reply) => {
    const body = TradeBody.parse(req.body);

    const ctx = await buildContext(body.leagueId);
    const rosters = await sleeper.getRosters(body.leagueId);

    const result = evaluateTrade(
      {
        rosterIdA: body.rosterIdA,
        rosterIdB: body.rosterIdB,
        sendPlayerIds: body.sendPlayerIds,
        receivePlayerIds: body.receivePlayerIds,
      },
      rosters,
      engine,
      ctx,
    );

    // Attach team names from users
    const users = await sleeper.getUsers(body.leagueId);
    const userMap = new Map(users.map((u) => [u.user_id, u]));
    const rosterA = rosters.find((r) => r.roster_id === body.rosterIdA);
    const rosterB = rosters.find((r) => r.roster_id === body.rosterIdB);
    if (rosterA) result.sideA.teamName = userMap.get(rosterA.owner_id)?.display_name ?? result.sideA.teamName;
    if (rosterB) result.sideB.teamName = userMap.get(rosterB.owner_id)?.display_name ?? result.sideB.teamName;

    return reply.send({ ...result, engine: engine.name });
  });

  // ── Waiver recommendations ──────────────────────────────────

  app.get('/api/brain/waiver/:leagueId/:rosterId', async (req, reply) => {
    const params = z.object({
      leagueId: z.string().min(1),
      rosterId: z.coerce.number().int().positive(),
    }).parse(req.params);

    const qs = z.object({
      limit: z.coerce.number().int().min(1).max(50).default(10),
    }).parse(req.query);

    const ctx = await buildContext(params.leagueId);
    const rosters = await sleeper.getRosters(params.leagueId);

    const result = recommendWaivers(
      { rosterId: params.rosterId, limit: qs.limit },
      rosters,
      engine,
      ctx,
    );

    return reply.send({ ...result, engine: engine.name });
  });

  // ── FAAB advisor ────────────────────────────────────────────

  app.get('/api/brain/faab/:leagueId/:rosterId', async (req, reply) => {
    const params = z.object({
      leagueId: z.string().min(1),
      rosterId: z.coerce.number().int().positive(),
    }).parse(req.params);

    const qs = z.object({
      limit: z.coerce.number().int().min(1).max(20).default(5),
    }).parse(req.query);

    const ctx = await buildContext(params.leagueId);
    const rosters = await sleeper.getRosters(params.leagueId);

    const result = adviseFaab(
      { rosterId: params.rosterId, limit: qs.limit },
      rosters,
      engine,
      ctx,
    );

    return reply.send({ ...result, engine: engine.name });
  });
}

// ── Shared helpers ────────────────────────────────────────────

/**
 * Build the ProjectionContext that all brain services need.
 * Fetches current NFL state, league info, player metadata, and recent stats.
 */
async function buildContext(leagueId: string): Promise<ProjectionContext> {
  const [league, nflState, players] = await Promise.all([
    sleeper.getLeague(leagueId),
    sleeper.getNflState(),
    sleeper.getPlayers(),
  ]);

  const currentWeek = nflState.week;
  const totalWeeks = 17; // NFL regular season

  // Fetch stats for recent weeks (last 6 weeks or from week 1, whichever is less)
  const fromWeek = Math.max(1, currentWeek - 6);
  const toWeek = Math.max(1, currentWeek - 1); // don't include current in-progress week

  let playerStats: Record<string, Record<number, Record<string, number>>> = {};
  if (toWeek >= fromWeek) {
    playerStats = await sleeper.getPlayerStatsRange(
      nflState.season,
      fromWeek,
      toWeek,
    );
  }

  return {
    league,
    week: currentWeek,
    totalWeeks,
    playerStats,
    players,
  };
}

function detectScoringType(settings: Record<string, number>): string {
  const rec = settings.rec ?? 0;
  if (rec >= 1) return 'PPR';
  if (rec >= 0.5) return 'Half PPR';
  return 'Standard';
}
