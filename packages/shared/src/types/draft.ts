export type DraftStatus = 'scheduled' | 'in_progress' | 'paused' | 'completed';

export interface Draft {
  id: string;
  leagueId: string;
  status: DraftStatus;
  /** Total rounds (typically 15 for FPL squad size) */
  totalRounds: number;
  /** Current round (1-indexed) */
  currentRound: number;
  /** Current overall pick number (1-indexed) */
  currentPick: number;
  /** Seconds per pick */
  pickTimerSeconds: number;
  /** When the current pick timer started */
  pickTimerStartedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

/**
 * Pre-computed turn queue entry.
 * Generated before the draft starts; the full pick order
 * is materialized so the draft engine never computes order at pick time.
 */
export interface DraftQueueEntry {
  draftId: string;
  /** Overall pick number (1-indexed, unique per draft) */
  overallPick: number;
  /** Round number */
  round: number;
  /** Pick within the round (1-indexed) */
  pickInRound: number;
  /** League member ID who owns this pick */
  memberId: string;
  /** Claimed once a pick is made */
  playerId: number | null;
  /** When the pick was made */
  pickedAt: string | null;
  /** Whether this was an auto-pick (timer expired) */
  autoPick: boolean;
}

/**
 * Immutable pick event — the source of truth.
 * Draft queue entries reference these once a pick is made.
 */
export interface DraftPick {
  id: string;
  draftId: string;
  overallPick: number;
  memberId: string;
  playerId: number;
  autoPick: boolean;
  pickedAt: string;
}

/** What the client needs to render the draft room */
export interface DraftState {
  draft: Draft;
  queue: DraftQueueEntry[];
  picks: DraftPick[];
  /** Player IDs that have been drafted (fast lookup) */
  draftedPlayerIds: Set<number>;
  /** Current pick's member ID */
  onTheClock: string | null;
  /** Seconds remaining in current pick */
  timeRemaining: number | null;
}
