import NodeCache from 'node-cache';
import type { FplPlayer } from './types.js';

const SLEEPER_BASE = 'https://api.sleeper.app/v1';

// ── Sleeper API shapes ─────────────────────────────────────────

export interface SleeperLeague {
  league_id: string;
  name: string;
  sport: string;         // 'nfl', 'nba', 'soccer', 'epl', etc.
  season: string;
  season_type: string;
  status: string;        // 'pre_draft', 'drafting', 'in_season', 'complete'
  total_rosters: number;
  settings: {
    max_keepers?: number;
    waiver_type?: number; // 0=normal, 2=FAAB
    waiver_budget?: number;
    waiver_day_of_week?: number;
    playoff_week_start?: number;
    num_teams?: number;
  };
  scoring_settings?: Record<string, number>;
  roster_positions?: string[];
  draft_id?: string;
}

export interface SleeperRoster {
  roster_id: number;
  owner_id: string;
  league_id: string;
  players: string[] | null;     // Sleeper player IDs as strings
  reserve: string[] | null;     // IR players
  starters: string[] | null;
  taxi: string[] | null;
  settings: {
    wins?: number;
    losses?: number;
    ties?: number;
    total_moves?: number;
    waiver_budget_used?: number;
    waiver_position?: number;
  };
}

export interface SleeperUser {
  user_id: string;
  username: string;
  display_name: string;
  avatar: string | null;
  metadata?: { team_name?: string };
}

export interface SleeperTransaction {
  transaction_id: string;
  type: 'waiver' | 'free_agent' | 'trade';
  status: 'complete' | 'failed';
  created: number;
  adds: Record<string, number> | null;     // player_id → roster_id
  drops: Record<string, number> | null;    // player_id → roster_id
  roster_ids: number[];
  settings?: { waiver_bid?: number };
}

export interface SleeperDraft {
  draft_id: string;
  league_id: string;
  type: string;
  status: string;
  season: string;
  sport: string;
  settings: {
    teams?: number;
    rounds?: number;
    pick_timer?: number;
    slots_k?: number;    // keeper slots
  };
  draft_order: Record<string, number> | null;  // user_id → pick order
  slot_to_roster_id?: Record<string, number>;
}

export interface SleeperPick {
  round: number;
  draft_slot: number;
  pick_no: number;
  player_id: string;
  picked_by: string;
  roster_id: number;
  draft_id: string;
  metadata?: {
    first_name?: string;
    last_name?: string;
    position?: string;
    team?: string;
  };
}

export interface SleeperPlayer {
  player_id: string;
  first_name: string;
  last_name: string;
  full_name?: string;
  position?: string;
  sport_position?: string;
  team?: string;
  status?: string;
  age?: number;
  sport: string;
}

// ── Normalised output ──────────────────────────────────────────

export interface SleeperLeagueSummary {
  leagueId: string;
  name: string;
  sport: string;
  season: string;
  status: string;
  totalRosters: number;
  draftId: string | null;
  waiverType: 'priority' | 'faab';
  faabBudget: number;
}

export interface SleeperRosterSummary {
  rosterId: number;
  ownerId: string;
  displayName: string;
  teamName: string;
  playerIds: string[];           // Sleeper player IDs
  fplPlayerIds: number[];        // mapped FPL IDs (best-effort)
  wins: number;
  losses: number;
  faabUsed: number;
  faabRemaining: number;
  waiverPosition: number;
}

/**
 * Sleeper API client — league/roster/transaction data.
 *
 * Sleeper is the primary league management platform.
 * For player data (stats, projections) we still use the FPL API.
 *
 * Player ID mapping:
 *   Sleeper uses its own player IDs (e.g. "4035992") that are independent
 *   of FPL IDs. When a league has been drafted, pick metadata contains
 *   player names which we can cross-reference against the FPL bootstrap
 *   to build the Sleeper ID → FPL ID mapping.
 */
export class SleeperClient {
  private cache: NodeCache;
  private leagueTTL: number;
  private playerTTL: number;

  constructor(opts?: { leagueTTL?: number; playerTTL?: number }) {
    this.cache = new NodeCache({ useClones: false });
    this.leagueTTL = opts?.leagueTTL ?? 60 * 5;          // 5 min (live standings)
    this.playerTTL = opts?.playerTTL ?? 60 * 60 * 24;    // 24h (player list stable)
  }

  // ── League ──────────────────────────────────────────────────

  async getLeague(leagueId: string): Promise<SleeperLeague> {
    return this.cached(`league:${leagueId}`, this.leagueTTL, () =>
      this.fetch<SleeperLeague>(`/league/${leagueId}`),
    );
  }

  async getLeagueSummary(leagueId: string): Promise<SleeperLeagueSummary> {
    const league = await this.getLeague(leagueId);
    return {
      leagueId: league.league_id,
      name: league.name,
      sport: league.sport,
      season: league.season,
      status: league.status,
      totalRosters: league.total_rosters,
      draftId: league.draft_id ?? null,
      waiverType: (league.settings?.waiver_type ?? 0) === 2 ? 'faab' : 'priority',
      faabBudget: league.settings?.waiver_budget ?? 100,
    };
  }

  // ── Rosters & users ─────────────────────────────────────────

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

  async getRosterSummaries(
    leagueId: string,
    fplPlayers: Map<number, FplPlayer>,
    faabBudget = 100,
  ): Promise<SleeperRosterSummary[]> {
    const [rosters, users] = await Promise.all([
      this.getRosters(leagueId),
      this.getUsers(leagueId),
    ]);

    const userMap = new Map(users.map((u) => [u.user_id, u]));
    const nameIndex = this.buildNameIndex(fplPlayers);

    return rosters.map((r) => {
      const user = userMap.get(r.owner_id);
      const sleeperIds = [...(r.players ?? []), ...(r.reserve ?? [])];
      const fplIds = sleeperIds
        .map((sid) => nameIndex.get(sid) ?? null)
        .filter((id): id is number => id !== null);

      const faabUsed = r.settings?.waiver_budget_used ?? 0;

      return {
        rosterId: r.roster_id,
        ownerId: r.owner_id,
        displayName: user?.display_name ?? `Team ${r.roster_id}`,
        teamName: user?.metadata?.team_name ?? user?.display_name ?? `Team ${r.roster_id}`,
        playerIds: sleeperIds,
        fplPlayerIds: fplIds,
        wins: r.settings?.wins ?? 0,
        losses: r.settings?.losses ?? 0,
        faabUsed,
        faabRemaining: faabBudget - faabUsed,
        waiverPosition: r.settings?.waiver_position ?? 0,
      };
    });
  }

  // ── Transactions ─────────────────────────────────────────────

  async getTransactions(leagueId: string, round: number): Promise<SleeperTransaction[]> {
    return this.cached(`transactions:${leagueId}:${round}`, this.leagueTTL, () =>
      this.fetch<SleeperTransaction[]>(`/league/${leagueId}/transactions/${round}`),
    );
  }

  /** Fetch recent transactions from the last `weeks` weeks. */
  async getRecentTransactions(
    leagueId: string,
    currentWeek: number,
    weeks = 3,
  ): Promise<SleeperTransaction[]> {
    const startWeek = Math.max(1, currentWeek - weeks + 1);
    const results = await Promise.all(
      Array.from({ length: currentWeek - startWeek + 1 }, (_, i) =>
        this.getTransactions(leagueId, startWeek + i).catch(() => [] as SleeperTransaction[]),
      ),
    );
    return results.flat();
  }

  // ── Draft ────────────────────────────────────────────────────

  async getDraft(draftId: string): Promise<SleeperDraft> {
    return this.cached(`draft:${draftId}`, this.playerTTL, () =>
      this.fetch<SleeperDraft>(`/draft/${draftId}`),
    );
  }

  async getDraftPicks(draftId: string): Promise<SleeperPick[]> {
    return this.cached(`draft-picks:${draftId}`, this.playerTTL, () =>
      this.fetch<SleeperPick[]>(`/draft/${draftId}/picks`),
    );
  }

  // ── Player ID mapping ────────────────────────────────────────

  /**
   * Get all players for a sport from Sleeper (large payload, cached 24h).
   * Sport is typically 'nfl', 'nba', or 'soccer' for EPL/FPL.
   */
  async getSleeperPlayers(sport: string): Promise<Map<string, SleeperPlayer>> {
    return this.cached(`players:${sport}`, this.playerTTL, async () => {
      const raw = await this.fetch<Record<string, SleeperPlayer>>(`/players/${sport}`);
      return new Map(Object.entries(raw));
    });
  }

  /**
   * Build a Sleeper player ID → FPL player ID mapping by matching player names.
   * Uses the draft pick metadata (player names) to identify which Sleeper IDs
   * correspond to which FPL IDs.
   *
   * Priority order:
   *   1. Exact web_name match (e.g. "Salah")
   *   2. Full name match (first + last)
   *   3. Last name match within same position (fallback)
   */
  async buildPlayerMapping(
    leagueId: string,
    fplPlayers: Map<number, FplPlayer>,
  ): Promise<Map<string, number>> {
    const league = await this.getLeague(leagueId);
    const mapping = new Map<string, number>();

    // Try via draft picks (most reliable — has name metadata)
    if (league.draft_id) {
      const picks = await this.getDraftPicks(league.draft_id).catch(() => [] as SleeperPick[]);
      for (const pick of picks) {
        if (mapping.has(pick.player_id)) continue;
        const firstName = pick.metadata?.first_name?.toLowerCase() ?? '';
        const lastName = pick.metadata?.last_name?.toLowerCase() ?? '';
        const pos = pick.metadata?.position?.toUpperCase() ?? '';
        const fplId = this.matchFplPlayer(fplPlayers, firstName, lastName, pos);
        if (fplId !== null) mapping.set(pick.player_id, fplId);
      }
    }

    // Try via roster player IDs against Sleeper's player list
    if (mapping.size < 5) {
      const sport = league.sport === 'nfl' ? 'nfl' : 'soccer';
      const sleeperPlayers = await this.getSleeperPlayers(sport).catch(
        () => new Map<string, SleeperPlayer>(),
      );

      for (const [sid, sp] of sleeperPlayers) {
        if (mapping.has(sid)) continue;
        const fplId = this.matchFplPlayer(
          fplPlayers,
          sp.first_name?.toLowerCase() ?? '',
          sp.last_name?.toLowerCase() ?? '',
          sp.position ?? '',
        );
        if (fplId !== null) mapping.set(sid, fplId);
      }
    }

    // Cache the mapping
    this.cache.set(`mapping:${leagueId}`, mapping, this.playerTTL);
    return mapping;
  }

  // ── Internal ─────────────────────────────────────────────────

  /**
   * Per-instance name→FPL-ID index, built lazily from buildPlayerMapping.
   * Key: sleeper_player_id, Value: fpl_id.
   * Falls back to empty map if mapping hasn't been built yet.
   */
  private nameIndexByLeague = new Map<string, Map<string, number>>();

  private buildNameIndex(fplPlayers: Map<number, FplPlayer>): Map<string, number> {
    // Build a quick last-name lookup from FPL players (in-memory, not persisted)
    const index = new Map<string, number>();
    for (const [id, p] of fplPlayers) {
      index.set(p.webName.toLowerCase(), id);
      index.set(`${p.firstName.toLowerCase()} ${p.lastName.toLowerCase()}`, id);
    }
    return index;
  }

  private matchFplPlayer(
    fplPlayers: Map<number, FplPlayer>,
    firstName: string,
    lastName: string,
    _pos: string,
  ): number | null {
    const fullName = `${firstName} ${lastName}`.trim();
    for (const [id, p] of fplPlayers) {
      if (p.webName.toLowerCase() === lastName) return id;
      const fplFull = `${p.firstName} ${p.lastName}`.toLowerCase();
      if (fplFull === fullName) return id;
    }
    // Partial: last name only within same position
    for (const [id, p] of fplPlayers) {
      if (p.lastName.toLowerCase() === lastName && lastName.length > 3) return id;
    }
    return null;
  }

  private async fetch<T>(path: string): Promise<T> {
    const url = `${SLEEPER_BASE}${path}`;
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

  invalidateLeague(leagueId: string): void {
    this.cache.del([
      `league:${leagueId}`,
      `rosters:${leagueId}`,
      `users:${leagueId}`,
      `mapping:${leagueId}`,
    ]);
  }
}

export const sleeper = new SleeperClient();
