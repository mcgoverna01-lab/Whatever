import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { registerDraftWebSocket } from './ws/draft-room.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerDraftRoutes } from './routes/draft.js';
import { registerLeagueRoutes } from './routes/league.js';
import { registerPlayerRoutes } from './routes/player.js';
import { registerWaiverRoutes } from './routes/waiver.js';
import { registerTradeRoutes } from './routes/trade.js';
import { registerH2HRoutes } from './routes/h2h.js';
import { scheduler } from './scheduler/index.js';

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
  await registerAuthRoutes(app);
  await registerDraftRoutes(app);
  await registerLeagueRoutes(app);
  await registerPlayerRoutes(app);
  await registerWaiverRoutes(app);
  await registerTradeRoutes(app);
  await registerH2HRoutes(app);
  await registerDraftWebSocket(app);

  // Health check
  app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

  const port = parseInt(process.env.PORT ?? '3000', 10);
  const host = process.env.HOST ?? '0.0.0.0';

  await app.listen({ port, host });
  app.log.info(`Pitch Draft server listening on ${host}:${port}`);

  // Start background scheduler
  if (process.env.DISABLE_SCHEDULER !== 'true') {
    scheduler.start();
  }
}

// Graceful shutdown
const shutdown = async () => {
  scheduler.stop();
  await app.close();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

export { app };
