import NodeCache from 'node-cache';
import type {
  SleeperLeague,
  SleeperRoster,
  SleeperUser,
  SleeperPlayer,
  SleeperNflState,
  SleeperWeekStats,
} from './types.js';

const BASE = 'https://api.sleeper.app/v1';

/**
 * Sleeper API client with built-in caching.
 *
 * Sleeper's API is public, unauthenticated, and rate-limit-friendly.
 * We cache aggressively because:
 * - Player metadata (~10 MB) changes rarely → 24h TTL
 * - Completed week stats never change → very long TTL
 * - League/roster data changes during waivers → 5 min TTL
 */
export class SleeperClient {
  private cache: NodeCache;

  constructor(opts?: { playerTTL?: number; leagueTTL?: number; statsTTL?: number }) {
    this.cache = new NodeCache({ useClones: false });
    this.playerTTL = opts?.playerTTL ?? 60 * 60 * 24;  // 24h
    this.leagueTTL = opts?.leagueTTL ?? 60 * 5;         // 5m
    this.statsTTL = opts?.statsTTL ?? 60 * 60 * 6;      // 6h
  }

  private playerTTL: number;
  private leagueTTL: number;
  private statsTTL: number;

  // ── League data ─────────────────────────────────────────────

  async getLeague(leagueId: string): Promise<SleeperLeague> {
    return this.cached(`league:${leagueId}`, this.leagueTTL, () =>
      this.fetch<SleeperLeague>(`/league/${leagueId}`),
    );
  }

  async getRosters(leagueId: string): Promise<SleeperRoster[]> {
    return this.cached(`rosters:${leagueId}`, this.leagueTTL, () =>
      this.fetch<SleeperRoster[]>(`/league/${leagueId}/rosters`),
    );
  }

  async getUsers(leagueId: string): Promise<SleeperUser[]> {
    return this.cached(`users:${leagueId}`, this.leagueTTL, () =>
      this.fetch<SleeperUser[]>(`/league/${leagueId}/users`),
    );
  }

  // ── Player metadata ─────────────────────────────────────────

  async getPlayers(): Promise<Record<string, SleeperPlayer>> {
    return this.cached('players:nfl', this.playerTTL, () =>
      this.fetch<Record<string, SleeperPlayer>>('/players/nfl'),
    );
  }

  // ── NFL state ───────────────────────────────────────────────

  async getNflState(): Promise<SleeperNflState> {
    return this.cached('state:nfl', this.leagueTTL, () =>
      this.fetch<SleeperNflState>('/state/nfl'),
    );
  }

  // ── Stats ───────────────────────────────────────────────────

  /**
   * Get all player stats for a single week.
   * Returns { playerId: { stat_category: value } }
   */
  async getWeekStats(
    season: string,
    week: number,
  ): Promise<Record<string, SleeperWeekStats>> {
    return this.cached(`stats:${season}:${week}`, this.statsTTL, () =>
      this.fetch<Record<string, SleeperWeekStats>>(
        `/stats/nfl/regular/${season}/${week}`,
      ),
    );
  }

  /**
   * Get player stats for a range of weeks (fetched in parallel).
   * Returns { playerId: { weekNum: stats } }
   */
  async getPlayerStatsRange(
    season: string,
    fromWeek: number,
    toWeek: number,
  ): Promise<Record<string, Record<number, SleeperWeekStats>>> {
    const weeks: number[] = [];
    for (let w = fromWeek; w <= toWeek; w++) weeks.push(w);

    const results = await Promise.all(
      weeks.map((w) => this.getWeekStats(season, w)),
    );

    const combined: Record<string, Record<number, SleeperWeekStats>> = {};
    results.forEach((weekData, i) => {
      const weekNum = weeks[i];
      for (const [playerId, stats] of Object.entries(weekData)) {
        if (!combined[playerId]) combined[playerId] = {};
        combined[playerId][weekNum] = stats;
      }
    });

    return combined;
  }

  // ── Helpers ─────────────────────────────────────────────────

  /**
   * Calculate fantasy points from raw Sleeper stats using league scoring settings.
   * This is how Sleeper itself calculates points: every stat category has a multiplier.
   */
  static calculatePoints(
    stats: SleeperWeekStats,
    scoringSettings: Record<string, number>,
  ): number {
    let points = 0;
    for (const [stat, value] of Object.entries(stats)) {
      if (stat in scoringSettings) {
        points += value * scoringSettings[stat];
      }
    }
    return Math.round(points * 100) / 100;
  }

  /**
   * Build a lookup: { ownerId → roster }.
   */
  static rostersByOwner(rosters: SleeperRoster[]): Map<string, SleeperRoster> {
    const map = new Map<string, SleeperRoster>();
    for (const r of rosters) {
      if (r.owner_id) map.set(r.owner_id, r);
    }
    return map;
  }

  /**
   * Get the set of all rostered player IDs across a league.
   */
  static rosteredPlayerIds(rosters: SleeperRoster[]): Set<string> {
    const ids = new Set<string>();
    for (const r of rosters) {
      if (r.players) {
        for (const id of r.players) ids.add(id);
      }
    }
    return ids;
  }

  // ── Internal ────────────────────────────────────────────────

  private async fetch<T>(path: string): Promise<T> {
    const url = `${BASE}${path}`;
    const res = await globalThis.fetch(url);
    if (!res.ok) {
      const err = new Error(`Sleeper API error: ${res.status} ${res.statusText} (${path})`);
      (err as any).status = res.status;
      (err as any).code = 'SLEEPER_API_ERROR';
      throw err;
    }
    return res.json() as Promise<T>;
  }

  private async cached<T>(key: string, ttl: number, loader: () => Promise<T>): Promise<T> {
    const hit = this.cache.get<T>(key);
    if (hit !== undefined) return hit;
    const data = await loader();
    this.cache.set(key, data, ttl);
    return data;
  }
}

/** Singleton instance — import this for convenience. */
export const sleeper = new SleeperClient();
