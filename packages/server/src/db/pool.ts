import pg from 'pg';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgresql://pitch:pitch@localhost:5432/pitch_draft',
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on('error', (err) => {
  console.error('Unexpected pool error:', err);
});

/**
 * Execute a query with automatic client checkout/return.
 */
export async function query<T extends pg.QueryResultRow = any>(
  text: string,
  params?: unknown[],
): Promise<pg.QueryResult<T>> {
  return pool.query<T>(text, params);
}

/**
 * Run a function within a transaction.
 * Automatically rolls back on error.
 */
export async function withTransaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Acquire a PostgreSQL advisory lock for the duration of a callback.
 * Uses transaction-scoped advisory locks (automatically released on COMMIT/ROLLBACK).
 *
 * Lock key derivation: hash the draft ID to a bigint.
 * Advisory locks are per-database, so namespace collisions are possible
 * but unlikely with UUIDs hashed to bigint.
 */
export async function withAdvisoryLock<T>(
  client: pg.PoolClient,
  lockKey: string,
  fn: () => Promise<T>,
): Promise<T> {
  // Hash UUID to a numeric lock key using first 8 bytes
  const hashResult = await client.query<{ lock_key: string }>(
    `SELECT ('x' || left(md5($1), 16))::bit(64)::bigint AS lock_key`,
    [lockKey],
  );
  const numericKey = hashResult.rows[0].lock_key;

  // pg_advisory_xact_lock: blocks until lock acquired, released at end of transaction
  await client.query('SELECT pg_advisory_xact_lock($1)', [numericKey]);

  return fn();
}
