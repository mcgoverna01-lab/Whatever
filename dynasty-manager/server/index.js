import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import sleeperRoutes from './routes/sleeper.js';
import analysisRoutes from './routes/analysis.js';
import { initPlayerCache } from './services/players.js';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: process.env.CORS_ORIGIN || 'http://localhost:5173' }));
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'dynasty-manager', ts: Date.now() });
});

app.use('/api/sleeper', sleeperRoutes);
app.use('/api/analysis', analysisRoutes);

app.use((err, _req, res, _next) => {
  console.error('[server:error]', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
    code: err.code || 'INTERNAL'
  });
});

initPlayerCache().catch((err) => {
  console.warn('[players] cache init failed, will lazy-load:', err.message);
});

app.listen(PORT, () => {
  console.log(`\u2022 Dynasty Manager server listening on http://localhost:${PORT}`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('[warn] ANTHROPIC_API_KEY is not set — /api/analysis will fail until you set it.');
  }
});
