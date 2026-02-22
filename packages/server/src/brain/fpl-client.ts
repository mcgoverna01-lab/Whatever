import NodeCache from 'node-cache';
import type { Position } from '@pitch-draft/shared';
import type {
  FplBootstrapResponse,
  FplFixture,
  FplLiveResponse,
  FplPlayer,
  FplClub,
  Fixture,
  ProjectionContext,
} from './types.js';

const FPL_BASE = 'https://fantasy.premierleague.com/api';

const ELEMENT_TYPE_TO_POS: Record<number, Position> = {
  1: 'GKP',
  2: 'DEF',
  3: 'MID',
  4: 'FWD',
};

/**
 * FPL API client with aggressive caching.
 *
 * Fetches from the official Fantasy Premier League API:
 * - Bootstrap: all players, teams, events (gameweeks)
 * - Fixtures: full schedule with FDR (fixture difficulty ratings)
 * - Live: per-player stats for a given gameweek
 *
 * All public, no authentication required.
 */
export class FplClient {
  private cache: NodeCache;
  private bootstrapTTL: number;
  private fixtureTTL: number;
  private liveTTL: number;

  constructor(opts?: { bootstrapTTL?: number; fixtureTTL?: number; liveTTL?: number }) {
    this.cache = new NodeCache({ useClones: false });
    this.bootstrapTTL = opts?.bootstrapTTL ?? 60 * 60 * 6;   // 6h
    this.fixtureTTL = opts?.fixtureTTL ?? 60 * 60 * 6;        // 6h
    this.liveTTL = opts?.liveTTL ?? 60 * 5;                    // 5m during live GWs
  }

  // ── Raw API ─────────────────────────────────────────────────

  async getBootstrap(): Promise<FplBootstrapResponse> {
    return this.cached('bootstrap', this.bootstrapTTL, () =>
      this.fetch<FplBootstrapResponse>('/bootstrap-static/'),
    );
  }

  async getRawFixtures(): Promise<FplFixture[]> {
    return this.cached('fixtures:raw', this.fixtureTTL, () =>
      this.fetch<FplFixture[]>('/fixtures/'),
    );
  }

  async getGameweekLive(gameweek: number): Promise<FplLiveResponse> {
    return this.cached(`live:${gameweek}`, this.liveTTL, () =>
      this.fetch<FplLiveResponse>(`/event/${gameweek}/live/`),
    );
  }

  // ── Processed data ──────────────────────────────────────────

  async getPlayers(): Promise<Map<number, FplPlayer>> {
    return this.cached('players:map', this.bootstrapTTL, async () => {
      const bootstrap = await this.getBootstrap();
      const teamMap = new Map(bootstrap.teams.map((t) => [t.id, t]));
      const map = new Map<number, FplPlayer>();

      for (const el of bootstrap.elements) {
        const team = teamMap.get(el.team);
        map.set(el.id, {
          id: el.id,
          webName: el.web_name,
          firstName: el.first_name,
          lastName: el.second_name,
          position: ELEMENT_TYPE_TO_POS[el.element_type] ?? 'MID',
          teamId: el.team,
          clubCode: team?.short_name ?? '???',
          clubName: team?.name ?? 'Unknown',
          nowCost: el.now_cost,
          totalPoints: el.total_points,
          ppg: parseFloat(el.points_per_game) || 0,
          form: parseFloat(el.form) || 0,
          ictIndex: parseFloat(el.ict_index) || 0,
          minutes: el.minutes,
          status: el.status,
          news: el.news || null,
          chanceOfPlayingThisRound: el.chance_of_playing_this_round,
          chanceOfPlayingNextRound: el.chance_of_playing_next_round,
          epThis: el.ep_this ? parseFloat(el.ep_this) : null,
          epNext: el.ep_next ? parseFloat(el.ep_next) : null,
        });
      }
      return map;
    });
  }

  async getClubs(): Promise<Map<number, FplClub>> {
    return this.cached('clubs:map', this.bootstrapTTL, async () => {
      const bootstrap = await this.getBootstrap();
      const map = new Map<number, FplClub>();

      for (const t of bootstrap.teams) {
        map.set(t.id, {
          id: t.id,
          name: t.name,
          shortName: t.short_name,
          strength: t.strength,
          strengthAttackHome: t.strength_attack_home,
          strengthAttackAway: t.strength_attack_away,
          strengthDefenceHome: t.strength_defence_home,
          strengthDefenceAway: t.strength_defence_away,
        });
      }
      return map;
    });
  }

  async getFixtures(): Promise<Fixture[]> {
    return this.cached('fixtures:parsed', this.fixtureTTL, async () => {
      const raw = await this.getRawFixtures();
      return raw.map((f) => ({
        id: f.id,
        gameweek: f.event,
        homeTeamId: f.team_h,
        awayTeamId: f.team_a,
        homeDifficulty: f.team_h_difficulty,
        awayDifficulty: f.team_a_difficulty,
        finished: f.finished,
      }));
    });
  }

  async getCurrentGameweek(): Promise<number> {
    const bootstrap = await this.getBootstrap();
    const current = bootstrap.events.find((e) => e.is_current);
    const next = bootstrap.events.find((e) => e.is_next);
    return current?.id ?? next?.id ?? 1;
  }

  // ── Fixture helpers ─────────────────────────────────────────

  /**
   * Fixtures for a team across a GW range, grouped by gameweek.
   * Handles blanks (empty array) and doubles (2+ entries).
   */
  static teamFixturesInRange(
    teamId: number,
    fixtures: Fixture[],
    fromGw: number,
    toGw: number,
  ): Map<number, Array<{ opponentId: number; difficulty: number; isHome: boolean }>> {
    const result = new Map<number, Array<{ opponentId: number; difficulty: number; isHome: boolean }>>();
    for (let gw = fromGw; gw <= toGw; gw++) result.set(gw, []);

    for (const f of fixtures) {
      if (f.gameweek === null || f.gameweek < fromGw || f.gameweek > toGw) continue;
      if (f.homeTeamId === teamId) {
        result.get(f.gameweek)!.push({ opponentId: f.awayTeamId, difficulty: f.homeDifficulty, isHome: true });
      } else if (f.awayTeamId === teamId) {
        result.get(f.gameweek)!.push({ opponentId: f.homeTeamId, difficulty: f.awayDifficulty, isHome: false });
      }
    }
    return result;
  }

  /** Average FDR for a team over the next `count` gameweeks. 3.0 if no data. */
  static averageFdr(teamId: number, fixtures: Fixture[], fromGw: number, count: number): number {
    const range = FplClient.teamFixturesInRange(teamId, fixtures, fromGw, fromGw + count - 1);
    const difficulties: number[] = [];
    for (const gwFixtures of range.values()) {
      for (const f of gwFixtures) difficulties.push(f.difficulty);
    }
    return difficulties.length > 0
      ? difficulties.reduce((a, b) => a + b, 0) / difficulties.length
      : 3.0;
  }

  // ── Full context builder ────────────────────────────────────

  /**
   * Build the ProjectionContext all brain services need.
   * Fetches players, clubs, fixtures, and recent GW stats in parallel.
   */
  async buildContext(): Promise<ProjectionContext> {
    const [players, clubs, fixtures, currentGw] = await Promise.all([
      this.getPlayers(),
      this.getClubs(),
      this.getFixtures(),
      this.getCurrentGameweek(),
    ]);

    // Fetch recent completed GW stats (last 5)
    const recentStats = new Map<number, Array<{ gameweek: number; totalPoints: number; minutes: number }>>();
    const completedGws: number[] = [];
    for (let gw = Math.max(1, currentGw - 5); gw < currentGw; gw++) {
      completedGws.push(gw);
    }

    if (completedGws.length > 0) {
      const liveResults = await Promise.all(
        completedGws.map((gw) => this.getGameweekLive(gw).catch(() => null)),
      );

      for (let i = 0; i < liveResults.length; i++) {
        const live = liveResults[i];
        if (!live) continue;
        const gw = completedGws[i];
        for (const el of live.elements) {
          if (!recentStats.has(el.id)) recentStats.set(el.id, []);
          recentStats.get(el.id)!.push({
            gameweek: gw,
            totalPoints: el.stats.total_points,
            minutes: el.stats.minutes,
          });
        }
      }
    }

    return { currentGameweek: currentGw, totalGameweeks: 38, players, clubs, fixtures, recentStats };
  }

  // ── Internal ────────────────────────────────────────────────

  private async fetch<T>(path: string): Promise<T> {
    const url = `${FPL_BASE}${path}`;
    const res = await globalThis.fetch(url);
    if (!res.ok) {
      const err = new Error(`FPL API error: ${res.status} ${res.statusText} (${path})`);
      (err as any).status = res.status;
      (err as any).code = 'FPL_API_ERROR';
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

export const fpl = new FplClient();
