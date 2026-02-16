export type LeagueStatus = 'pending' | 'drafting' | 'active' | 'completed';
export type DraftType = 'snake' | 'linear' | 'auction';

export interface League {
  id: string; // UUIDv7
  name: string;
  season: string; // e.g. '2025-26'
  /** Number of manager slots */
  size: number;
  draftType: DraftType;
  /** FAAB budget per season (in whole units, e.g. 100) */
  faabBudget: number;
  /** Scoring system ID */
  scoringPresetId: string;
  status: LeagueStatus;
  /** Waiver processing day (1=Mon ... 7=Sun), null = continuous */
  waiverDeadlineDay: number | null;
  /** ISO timestamp */
  draftScheduledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LeagueMember {
  id: string;
  leagueId: string;
  userId: string;
  teamName: string;
  /** Draft seed position (1-indexed, set before draft) */
  draftSeed: number | null;
  /** Current FAAB remaining */
  faabRemaining: number;
  joinedAt: string;
}

export interface Roster {
  memberId: string;
  leagueId: string;
  players: RosterSlot[];
}

export interface RosterSlot {
  playerId: number;
  /** Starting XI position or bench slot */
  slot: 'GKP' | 'DEF' | 'MID' | 'FWD' | 'BENCH';
  /** Bench order (0-3), null for starters */
  benchOrder: number | null;
  /** Gameweek this roster is effective for (null = current active) */
  gameweek: number | null;
}
