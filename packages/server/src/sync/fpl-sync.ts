import { pool, query, withTransaction } from '../db/pool.js';

const FPL_BASE = 'https://fantasy.premierleague.com/api';

const POSITION_MAP: Record<number, string> = {
  1: 'GKP',
  2: 'DEF',
  3: 'MID',
  4: 'FWD',
};

interface FPLBootstrap {
  elements: FPLElement[];
  teams: FPLTeam[];
  events: FPLEvent[];
}

interface FPLElement {
  id: number;
  web_name: string;
  first_name: string;
  second_name: string;
  element_type: number;
  team: number;
  now_cost: number;
  total_points: number;
  points_per_game: string;
  minutes: number;
  status: string;
  news: string;
  chance_of_playing_next_round: number | null;
}

interface FPLTeam {
  id: number;
  short_name: string;
  name: string;
}

interface FPLEvent {
  id: number;
  name: string;
  finished: boolean;
  is_current: boolean;
  is_next: boolean;
  deadline_time: string;
}

interface FPLLiveElement {
  id: number;
  stats: {
    minutes: number;
    goals_scored: number;
    assists: number;
    clean_sheets: number;
    goals_conceded: number;
    saves: number;
    penalties_saved: number;
    penalties_missed: number;
    yellow_cards: number;
    red_cards: number;
    own_goals: number;
    bonus: number;
    total_points: number;
  };
}

/**
 * Sync player data from the FPL bootstrap-static endpoint.
 * Updates player profiles (cost, points, availability, news).
 * Run this on a schedule — every 6 hours during the season is reasonable.
 */
export async function syncBootstrap(): Promise<{ playersUpdated: number }> {
  const logId = await startSyncLog('bootstrap');

  try {
    const res = await fetch(`${FPL_BASE}/bootstrap-static/`);
    if (!res.ok) throw new Error(`FPL API returned ${res.status}`);

    const data: FPLBootstrap = await res.json();

    const teamMap = new Map<number, FPLTeam>();
    for (const team of data.teams) {
      teamMap.set(team.id, team);
    }

    let updated = 0;
    await withTransaction(async (client) => {
      for (const el of data.elements) {
        const team = teamMap.get(el.team);
        if (!team) continue;

        const result = await client.query(
          `INSERT INTO players (
            fpl_id, web_name, first_name, last_name, position,
            club_code, club_name, now_cost, total_points, points_per_game,
            minutes, available, news, chance_of_playing_next_round, synced_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,now())
          ON CONFLICT (fpl_id) DO UPDATE SET
            web_name = EXCLUDED.web_name,
            first_name = EXCLUDED.first_name,
            last_name = EXCLUDED.last_name,
            position = EXCLUDED.position,
            club_code = EXCLUDED.club_code,
            club_name = EXCLUDED.club_name,
            now_cost = EXCLUDED.now_cost,
            total_points = EXCLUDED.total_points,
            points_per_game = EXCLUDED.points_per_game,
            minutes = EXCLUDED.minutes,
            available = EXCLUDED.available,
            news = EXCLUDED.news,
            chance_of_playing_next_round = EXCLUDED.chance_of_playing_next_round,
            synced_at = now()`,
          [
            el.id, el.web_name, el.first_name, el.second_name,
            POSITION_MAP[el.element_type], team.short_name, team.name,
            el.now_cost, el.total_points, parseFloat(el.points_per_game),
            el.minutes, el.status === 'a', el.news || null,
            el.chance_of_playing_next_round,
          ],
        );
        updated++;
      }
    });

    await completeSyncLog(logId, updated);
    return { playersUpdated: updated };
  } catch (err) {
    await failSyncLog(logId, err);
    throw err;
  }
}

/**
 * Sync gameweek live stats from FPL.
 * Call after matches to update gameweek_stats.
 *
 * The FPL live endpoint returns all player stats for a given gameweek.
 * This is how we get per-GW goals, assists, clean sheets, etc.
 */
export async function syncGameweekStats(gameweek: number): Promise<{ playersUpdated: number }> {
  const logId = await startSyncLog('gameweek_stats', gameweek);

  try {
    const res = await fetch(`${FPL_BASE}/event/${gameweek}/live/`);
    if (!res.ok) throw new Error(`FPL API returned ${res.status}`);

    const data: { elements: FPLLiveElement[] } = await res.json();

    // We need to map FPL element IDs to our internal player IDs
    const fplIdMap = await buildFplIdMap();

    let updated = 0;
    await withTransaction(async (client) => {
      for (const el of data.elements) {
        const playerId = fplIdMap.get(el.id);
        if (!playerId) continue;

        const s = el.stats;
        await client.query(
          `INSERT INTO gameweek_stats (
            player_id, gameweek, minutes, goals, assists, clean_sheet,
            goals_conceded, saves, penalties_saved, penalties_missed,
            yellow_cards, red_cards, own_goals, bonus, total_points, synced_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,now())
          ON CONFLICT (player_id, gameweek) DO UPDATE SET
            minutes = EXCLUDED.minutes,
            goals = EXCLUDED.goals,
            assists = EXCLUDED.assists,
            clean_sheet = EXCLUDED.clean_sheet,
            goals_conceded = EXCLUDED.goals_conceded,
            saves = EXCLUDED.saves,
            penalties_saved = EXCLUDED.penalties_saved,
            penalties_missed = EXCLUDED.penalties_missed,
            yellow_cards = EXCLUDED.yellow_cards,
            red_cards = EXCLUDED.red_cards,
            own_goals = EXCLUDED.own_goals,
            bonus = EXCLUDED.bonus,
            total_points = EXCLUDED.total_points,
            synced_at = now()`,
          [
            playerId, gameweek, s.minutes, s.goals_scored, s.assists,
            s.clean_sheets > 0, s.goals_conceded, s.saves,
            s.penalties_saved, s.penalties_missed, s.yellow_cards,
            s.red_cards, s.own_goals, s.bonus, s.total_points,
          ],
        );
        updated++;
      }
    });

    await completeSyncLog(logId, updated);
    return { playersUpdated: updated };
  } catch (err) {
    await failSyncLog(logId, err);
    throw err;
  }
}

/**
 * Get the current gameweek from FPL.
 */
export async function getCurrentGameweek(): Promise<{
  current: number;
  isFinished: boolean;
  next: number | null;
  deadline: string | null;
}> {
  const res = await fetch(`${FPL_BASE}/bootstrap-static/`);
  if (!res.ok) throw new Error(`FPL API returned ${res.status}`);

  const data: FPLBootstrap = await res.json();

  const current = data.events.find((e) => e.is_current);
  const next = data.events.find((e) => e.is_next);

  return {
    current: current?.id ?? 1,
    isFinished: current?.finished ?? false,
    next: next?.id ?? null,
    deadline: next?.deadline_time ?? null,
  };
}

// ── Helpers ──────────────────────────────────────────────────────

async function buildFplIdMap(): Promise<Map<number, number>> {
  const result = await query<{ id: number; fpl_id: number }>(
    'SELECT id, fpl_id FROM players',
  );
  return new Map(result.rows.map((r) => [r.fpl_id, r.id]));
}

async function startSyncLog(
  syncType: string,
  gameweek?: number,
): Promise<number> {
  const result = await query<{ id: number }>(
    `INSERT INTO fpl_sync_log (sync_type, gameweek) VALUES ($1, $2) RETURNING id`,
    [syncType, gameweek ?? null],
  );
  return result.rows[0].id;
}

async function completeSyncLog(logId: number, playersUpdated: number): Promise<void> {
  await query(
    `UPDATE fpl_sync_log SET completed_at = now(), players_updated = $2 WHERE id = $1`,
    [logId, playersUpdated],
  );
}

async function failSyncLog(logId: number, err: unknown): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  await query(
    `UPDATE fpl_sync_log SET completed_at = now(), error = $2 WHERE id = $1`,
    [logId, message],
  );
}
