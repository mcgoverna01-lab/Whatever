import type { DraftPick, DraftQueueEntry } from './draft.js';
import type { WaiverClaim, FaabBid, Transaction } from './waiver.js';

/**
 * WebSocket event types for real-time draft sync.
 * Server → Client events are prefixed with 's:'.
 * Client → Server events are prefixed with 'c:'.
 */

// ── Client → Server ──────────────────────────────────────────────

export interface ClientMakePick {
  type: 'c:make_pick';
  draftId: string;
  playerId: number;
}

export interface ClientSetAutoPick {
  type: 'c:set_auto_pick';
  draftId: string;
  /** Ranked player IDs for auto-pick preference */
  rankings: number[];
}

export interface ClientJoinDraft {
  type: 'c:join_draft';
  draftId: string;
}

export interface ClientLeaveDraft {
  type: 'c:leave_draft';
  draftId: string;
}

export type ClientEvent =
  | ClientMakePick
  | ClientSetAutoPick
  | ClientJoinDraft
  | ClientLeaveDraft;

// ── Server → Client ──────────────────────────────────────────────

export interface ServerPickMade {
  type: 's:pick_made';
  pick: DraftPick;
  /** Updated current queue entry (next on the clock) */
  nextOnClock: DraftQueueEntry | null;
  /** Server timestamp for timer sync */
  serverTimestamp: string;
}

export interface ServerDraftStarted {
  type: 's:draft_started';
  draftId: string;
  firstOnClock: DraftQueueEntry;
  serverTimestamp: string;
}

export interface ServerDraftCompleted {
  type: 's:draft_completed';
  draftId: string;
}

export interface ServerTimerUpdate {
  type: 's:timer_update';
  draftId: string;
  secondsRemaining: number;
  serverTimestamp: string;
}

export interface ServerDraftPaused {
  type: 's:draft_paused';
  draftId: string;
  reason: string;
}

export interface ServerPickError {
  type: 's:pick_error';
  message: string;
  /** The pick that was attempted */
  playerId: number;
}

export interface ServerMemberPresence {
  type: 's:member_presence';
  draftId: string;
  memberId: string;
  online: boolean;
}

export interface ServerWaiverProcessed {
  type: 's:waiver_processed';
  leagueId: string;
  transactions: Transaction[];
}

export type ServerEvent =
  | ServerPickMade
  | ServerDraftStarted
  | ServerDraftCompleted
  | ServerTimerUpdate
  | ServerDraftPaused
  | ServerPickError
  | ServerMemberPresence
  | ServerWaiverProcessed;
