import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query } from '../db/pool.js';
import {
  hashPassword,
  verifyPassword,
  signAccessToken,
  generateRefreshToken,
  hashRefreshToken,
  authenticate,
} from '../auth/index.js';

const RegisterSchema = z.object({
  email: z.string().email().max(255),
  username: z.string().min(3).max(30).regex(/^[a-zA-Z0-9_]+$/),
  password: z.string().min(8).max(128),
});

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  // ── Register ─────────────────────────────────────────────────

  app.post('/api/auth/register', async (req, reply) => {
    const body = RegisterSchema.parse(req.body);

    // Check uniqueness
    const existing = await query(
      'SELECT id FROM users WHERE email = $1 OR username = $2',
      [body.email, body.username],
    );
    if (existing.rows.length > 0) {
      return reply.code(409).send({ error: 'Email or username already taken' });
    }

    const passwordHash = hashPassword(body.password);
    const userResult = await query(
      `INSERT INTO users (email, username, password_hash)
       VALUES ($1, $2, $3) RETURNING id, email, username, created_at`,
      [body.email, body.username, passwordHash],
    );
    const user = userResult.rows[0];

    // Issue tokens
    const accessToken = await signAccessToken({
      userId: user.id,
      username: user.username,
    });
    const refresh = generateRefreshToken();
    await query(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3)`,
      [user.id, refresh.hash, refresh.expiresAt],
    );

    return reply.code(201).send({
      user: { id: user.id, email: user.email, username: user.username },
      accessToken,
      refreshToken: refresh.raw,
    });
  });

  // ── Login ────────────────────────────────────────────────────

  app.post('/api/auth/login', async (req, reply) => {
    const body = LoginSchema.parse(req.body);

    const result = await query(
      'SELECT id, email, username, password_hash FROM users WHERE email = $1',
      [body.email],
    );
    if (result.rows.length === 0) {
      return reply.code(401).send({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];
    if (!verifyPassword(body.password, user.password_hash)) {
      return reply.code(401).send({ error: 'Invalid credentials' });
    }

    const accessToken = await signAccessToken({
      userId: user.id,
      username: user.username,
    });
    const refresh = generateRefreshToken();
    await query(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3)`,
      [user.id, refresh.hash, refresh.expiresAt],
    );

    return reply.send({
      user: { id: user.id, email: user.email, username: user.username },
      accessToken,
      refreshToken: refresh.raw,
    });
  });

  // ── Refresh ──────────────────────────────────────────────────

  app.post('/api/auth/refresh', async (req, reply) => {
    const { refreshToken } = z.object({ refreshToken: z.string() }).parse(req.body);

    const tokenHash = hashRefreshToken(refreshToken);
    const result = await query(
      `SELECT rt.*, u.username FROM refresh_tokens rt
       JOIN users u ON u.id = rt.user_id
       WHERE rt.token_hash = $1 AND NOT rt.revoked AND rt.expires_at > now()`,
      [tokenHash],
    );

    if (result.rows.length === 0) {
      return reply.code(401).send({ error: 'Invalid or expired refresh token' });
    }

    const row = result.rows[0];

    // Rotate: revoke old, issue new
    await query('UPDATE refresh_tokens SET revoked = true WHERE id = $1', [row.id]);

    const accessToken = await signAccessToken({
      userId: row.user_id,
      username: row.username,
    });
    const newRefresh = generateRefreshToken();
    await query(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3)`,
      [row.user_id, newRefresh.hash, newRefresh.expiresAt],
    );

    return reply.send({
      accessToken,
      refreshToken: newRefresh.raw,
    });
  });

  // ── Logout ───────────────────────────────────────────────────

  app.post('/api/auth/logout', {
    preHandler: authenticate,
  }, async (req, reply) => {
    // Revoke all refresh tokens for this user
    await query(
      'UPDATE refresh_tokens SET revoked = true WHERE user_id = $1 AND NOT revoked',
      [req.user!.sub],
    );
    return reply.send({ ok: true });
  });

  // ── Me ───────────────────────────────────────────────────────

  app.get('/api/auth/me', {
    preHandler: authenticate,
  }, async (req, reply) => {
    const result = await query(
      'SELECT id, email, username, created_at FROM users WHERE id = $1',
      [req.user!.sub],
    );
    if (result.rows.length === 0) {
      return reply.code(404).send({ error: 'User not found' });
    }
    return reply.send(result.rows[0]);
  });
}
