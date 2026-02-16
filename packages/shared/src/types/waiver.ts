export type WaiverStatus = 'pending' | 'processing' | 'approved' | 'rejected' | 'cancelled';
export type TransactionType = 'waiver' | 'faab' | 'free_agent' | 'trade';

/**
 * Waiver claim — standard priority-based waiver wire.
 * Priority resets inverse of standings (worst team = highest priority).
 * Successful claim moves you to lowest priority (rolling waivers).
 */
export interface WaiverClaim {
  id: string;
  leagueId: string;
  memberId: string;
  gameweek: number;
  /** Player to add */
  playerInId: number;
  /** Player to drop (required — roster must stay at 15) */
  playerOutId: number;
  /** Priority order within the member's claims (1 = highest) */
  priority: number;
  status: WaiverStatus;
  /** If rejected, why */
  rejectionReason: string | null;
  createdAt: string;
  processedAt: string | null;
}

/**
 * FAAB bid — sealed-bid blind auction for free agents.
 * Runs instead of (or alongside) standard waivers depending on league config.
 */
export interface FaabBid {
  id: string;
  leagueId: string;
  memberId: string;
  gameweek: number;
  playerInId: number;
  playerOutId: number;
  /** Bid amount (integer, from FAAB budget) */
  amount: number;
  status: WaiverStatus;
  /** Winning bid amount (set after processing) */
  winningAmount: number | null;
  rejectionReason: string | null;
  createdAt: string;
  processedAt: string | null;
}

/**
 * Immutable transaction log.
 * Every roster move — draft pick, waiver, FAAB, trade — produces one of these.
 */
export interface Transaction {
  id: string;
  leagueId: string;
  memberId: string;
  type: TransactionType;
  playerInId: number;
  playerOutId: number | null; // null for draft picks (adding to empty roster)
  gameweek: number | null; // null for draft
  /** FAAB amount spent (null for non-FAAB) */
  faabSpent: number | null;
  /** Reference to the source (waiver claim ID, FAAB bid ID, trade ID, draft pick ID) */
  sourceId: string;
  createdAt: string;
}

/**
 * Waiver processing order for a league.
 * After each successful claim, the claimant drops to the bottom.
 */
export interface WaiverPriority {
  leagueId: string;
  memberId: string;
  priority: number; // 1 = first claim priority
}
