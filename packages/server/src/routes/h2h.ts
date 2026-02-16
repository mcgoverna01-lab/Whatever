import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getH2HStandings, getH2HFixtures } from '../h2h/index.js';

export async function registerH2HRoutes(app: FastifyInstance): Promise<void> {
  // Get H2H standings
  app.get('/api/leagues/:leagueId/h2h/standings', async (req, reply) => {
    const { leagueId } = z.object({ leagueId: z.string().uuid() }).parse(req.params);
    const { gameweek } = z.object({
      gameweek: z.coerce.number().int().optional(),
    }).parse(req.query);

    const standings = await getH2HStandings(leagueId, gameweek);
    return reply.send(standings);
  });

  // Get H2H fixtures for a gameweek
  app.get('/api/leagues/:leagueId/h2h/fixtures', async (req, reply) => {
    const { leagueId } = z.object({ leagueId: z.string().uuid() }).parse(req.params);
    const { gameweek } = z.object({
      gameweek: z.coerce.number().int(),
    }).parse(req.query);

    const fixtures = await getH2HFixtures(leagueId, gameweek);
    return reply.send(fixtures);
  });
}
