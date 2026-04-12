/**
 * Player data cache.
 *
 * The Sleeper players endpoint returns ~10MB of JSON covering every NFL
 * player. We persist the latest snapshot in SQLite (as a single blob row)
 * and only refresh at most once per day. This keeps the frontend fast and
 * avoids hammering the Sleeper API.
 */
import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { getAllPlayers } from './sleeper.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_DIR = join(__dirname, '..', 'data');
const DB_PATH = join(DATA_DIR, 'players.db');

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

let db;
let memoryCache = { players: null, fetchedAt: 0 };

function openDb() {
  if (db) return db;
  mkdirSync(DATA_DIR, { recursive: true });
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS player_cache (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      fetched_at INTEGER NOT NULL,
      payload TEXT NOT NULL
    );
  `);
  return db;
}

function readCacheFromDisk() {
  const row = openDb().prepare('SELECT fetched_at, payload FROM player_cache WHERE id = 1').get();
  if (!row) return null;
  try {
    return { players: JSON.parse(row.payload), fetchedAt: row.fetched_at };
  } catch {
    return null;
  }
}

function writeCacheToDisk(players) {
  const fetchedAt = Date.now();
  openDb()
    .prepare('INSERT OR REPLACE INTO player_cache (id, fetched_at, payload) VALUES (1, ?, ?)')
    .run(fetchedAt, JSON.stringify(players));
  memoryCache = { players, fetchedAt };
}

export async function initPlayerCache() {
  const disk = readCacheFromDisk();
  if (disk) {
    memoryCache = disk;
    console.log(`[players] loaded ${Object.keys(disk.players).length} players from disk cache`);
  }
}

export async function getPlayers({ force = false } = {}) {
  const age = Date.now() - memoryCache.fetchedAt;
  if (!force && memoryCache.players && age < ONE_DAY_MS) {
    return memoryCache.players;
  }
  console.log('[players] refreshing from Sleeper...');
  const players = await getAllPlayers();
  writeCacheToDisk(players);
  return players;
}

/**
 * Reduce Sleeper's giant player record to just the dynasty-relevant fields.
 * We calculate age from birth_date where available.
 */
export function projectPlayer(raw) {
  if (!raw) return null;
  const age = raw.birth_date ? calcAge(raw.birth_date) : raw.age ?? null;
  return {
    id: raw.player_id,
    name: raw.full_name || `${raw.first_name ?? ''} ${raw.last_name ?? ''}`.trim(),
    position: raw.position,
    team: raw.team || 'FA',
    age,
    experience: raw.years_exp ?? 0,
    injury: raw.injury_status || null,
    status: raw.status || 'Active'
  };
}

function calcAge(birthDate) {
  const birth = new Date(birthDate);
  if (Number.isNaN(birth.getTime())) return null;
  const diff = Date.now() - birth.getTime();
  return Math.floor(diff / (365.25 * 24 * 60 * 60 * 1000));
}

export async function lookupPlayers(ids) {
  const all = await getPlayers();
  return ids.map((id) => projectPlayer(all[id])).filter(Boolean);
}
