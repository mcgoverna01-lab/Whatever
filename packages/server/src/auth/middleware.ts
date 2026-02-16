import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { verifyAccessToken, type TokenPayload } from './crypto.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: TokenPayload;
  }
}

/**
 * Auth middleware — extracts and verifies the JWT from the Authorization header.
 * Attach to routes via preHandler.
 */
export async function authenticate(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    reply.code(401).send({ error: 'Missing authorization header' });
    return;
  }

  const token = authHeader.slice(7);
  try {
    req.user = await verifyAccessToken(token);
  } catch {
    reply.code(401).send({ error: 'Invalid or expired token' });
  }
}

/**
 * Commissioner-only middleware.
 * Must be chained after `authenticate`.
 * Checks that the requesting user created the league.
 */
export function requireCommissioner(leagueIdParam: string = 'leagueId') {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!req.user) {
      reply.code(401).send({ error: 'Not authenticated' });
      return;
    }

    const leagueId = (req.params as Record<string, string>)[leagueIdParam];
    if (!leagueId) {
      reply.code(400).send({ error: 'Missing league ID' });
      return;
    }

    // Inline query to avoid circular dep
    const pg = await import('../db/pool.js');
    const result = await pg.query(
      'SELECT created_by FROM leagues WHERE id = $1',
      [leagueId],
    );

    if (result.rows.length === 0) {
      reply.code(404).send({ error: 'League not found' });
      return;
    }

    if (result.rows[0].created_by !== req.user.sub) {
      reply.code(403).send({ error: 'Commissioner access required' });
    }
  };
}
