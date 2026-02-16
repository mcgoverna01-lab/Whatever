import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { SignJWT, jwtVerify, type JWTPayload } from 'jose';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET ?? 'pitch-draft-dev-secret-change-in-prod',
);
const ACCESS_TOKEN_TTL = '15m';
const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface TokenPayload extends JWTPayload {
  sub: string; // user ID
  username: string;
}

// ── Password hashing (scrypt, no bcrypt dep) ─────────────────────

const SALT_LEN = 32;
const KEY_LEN = 64;
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };

export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_LEN);
  const derived = scryptSync(password, salt, KEY_LEN, SCRYPT_PARAMS);
  return `${salt.toString('hex')}:${derived.toString('hex')}`;
}

export function verifyPassword(password: string, hash: string): boolean {
  const [saltHex, keyHex] = hash.split(':');
  const salt = Buffer.from(saltHex, 'hex');
  const storedKey = Buffer.from(keyHex, 'hex');
  const derived = scryptSync(password, salt, KEY_LEN, SCRYPT_PARAMS);
  return timingSafeEqual(derived, storedKey);
}

// ── JWT ──────────────────────────────────────────────────────────

export async function signAccessToken(payload: {
  userId: string;
  username: string;
}): Promise<string> {
  return new SignJWT({ username: payload.username })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.userId)
    .setIssuedAt()
    .setExpirationTime(ACCESS_TOKEN_TTL)
    .sign(JWT_SECRET);
}

export async function verifyAccessToken(token: string): Promise<TokenPayload> {
  const { payload } = await jwtVerify(token, JWT_SECRET);
  return payload as TokenPayload;
}

// ── Refresh tokens ───────────────────────────────────────────────

export function generateRefreshToken(): {
  raw: string;
  hash: string;
  expiresAt: Date;
} {
  const raw = randomBytes(48).toString('hex');
  const hash = hashRefreshToken(raw);
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);
  return { raw, hash, expiresAt };
}

export function hashRefreshToken(token: string): string {
  const salt = Buffer.alloc(0); // deterministic hash for lookup
  return scryptSync(token, 'refresh-salt', 32, { N: 1024, r: 8, p: 1 }).toString('hex');
}
