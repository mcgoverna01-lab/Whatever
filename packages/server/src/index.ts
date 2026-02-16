import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { registerDraftWebSocket } from './ws/draft-room.js';
import { registerDraftRoutes } from './routes/draft.js';
import { registerLeagueRoutes } from './routes/league.js';
import { registerWaiverRoutes } from './routes/waiver.js';

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? 'info',
    transport:
      process.env.NODE_ENV !== 'production'
        ? { target: 'pino-pretty' }
        : undefined,
  },
});

async function start(): Promise<void> {
  await app.register(cors, {
    origin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  });

  await app.register(websocket);

  // Register routes
  await registerDraftRoutes(app);
  await registerLeagueRoutes(app);
  await registerWaiverRoutes(app);
  await registerDraftWebSocket(app);

  // Health check
  app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

  const port = parseInt(process.env.PORT ?? '3000', 10);
  const host = process.env.HOST ?? '0.0.0.0';

  await app.listen({ port, host });
  app.log.info(`Pitch Draft server listening on ${host}:${port}`);
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

export { app };
