// ── Sleeper API response shapes ─────────────────────────────────

export interface SleeperLeague {
  league_id: string;
  name: string;
  season: string;
  total_rosters: number;
  roster_positions: string[];       // ["QB","RB","RB","WR","WR","TE","FLEX","K","DEF","BN","BN",...]
  scoring_settings: Record<string, number>; // { pass_yd: 0.04, rush_td: 6, rec: 1, ... }
  settings: {
    waiver_type: number;            // 2 = FAAB
    waiver_budget: number;
    trade_deadline: number;         // week number
    [key: string]: unknown;
  };
  status: 'pre_draft' | 'drafting' | 'in_season' | 'complete';
}

export interface SleeperRoster {
  roster_id: number;
  owner_id: string;
  players: string[] | null;         // player ID strings
  starters: string[] | null;
  reserve: string[] | null;         // IR
  settings: {
    wins: number;
    losses: number;
    ties: number;
    fpts: number;
    fpts_decimal: number;
    fpts_against: number;
    fpts_against_decimal: number;
    waiver_budget_used: number;
    [key: string]: number;
  };
}

export interface SleeperUser {
  user_id: string;
  display_name: string;
  avatar: string | null;
}

export interface SleeperPlayer {
  player_id: string;
  first_name: string;
  last_name: string;
  full_name: string;
  position: string;                 // QB, RB, WR, TE, K, DEF
  team: string | null;              // NFL team abbreviation, null if FA
  age: number | null;
  years_exp: number | null;
  fantasy_positions: string[];
  status: string;                   // Active, Inactive, Injured Reserve, etc.
  injury_status: string | null;
  sport: string;
}

export interface SleeperNflState {
  season: string;                   // "2025"
  season_type: string;              // "regular"
  week: number;                     // current week
  display_week: number;
  leg: number;
}

/** Raw stat line for a player in a single week, keyed by stat category */
export type SleeperWeekStats = Record<string, number>;

// ── Projection types ────────────────────────────────────────────

export interface PlayerProjection {
  playerId: string;
  name: string;
  position: string;
  team: string | null;
  /** Projected rest-of-season total points */
  ros: number;
  /** Projected points per game */
  ppg: number;
  /** Confidence in projection (0–1) */
  confidence: number;
}

export interface ProjectionContext {
  league: SleeperLeague;
  week: number;
  totalWeeks: number;
  /** Per-player weekly stats: { playerId: { weekNum: stats } } */
  playerStats: Record<string, Record<number, SleeperWeekStats>>;
  /** All Sleeper player metadata (huge — only loaded once) */
  players: Record<string, SleeperPlayer>;
}

// ── Trade evaluation output ─────────────────────────────────────

export type TradeVerdict =
  | 'fair'
  | 'slightly_favors_a'
  | 'favors_a'
  | 'heavily_favors_a'
  | 'slightly_favors_b'
  | 'favors_b'
  | 'heavily_favors_b';

export interface TradeSideAnalysis {
  teamName: string;
  players: Array<{
    playerId: string;
    name: string;
    position: string;
    projectedROS: number;
    scarcityAdjusted: number;
  }>;
  totalRaw: number;
  totalAdjusted: number;
  rosterImpact: string;
}

export interface TradeEvaluation {
  verdict: TradeVerdict;
  /** -1 heavily favors A, 0 fair, +1 heavily favors B */
  fairnessScore: number;
  summary: string;
  sideA: TradeSideAnalysis;
  sideB: TradeSideAnalysis;
}

// ── Waiver recommendation output ────────────────────────────────

export interface WaiverRecommendation {
  player: {
    playerId: string;
    name: string;
    position: string;
    team: string | null;
  };
  projectedROS: number;
  improvementOver: {
    playerId: string;
    name: string;
    position: string;
    projectedROS: number;
  } | null;
  netGain: number;
  reason: string;
  suggestedDrop: {
    playerId: string;
    name: string;
    position: string;
  } | null;
}

export interface WaiverAnalysis {
  rosterNeeds: Array<{
    position: string;
    severity: 'low' | 'medium' | 'high';
    reason: string;
  }>;
  recommendations: WaiverRecommendation[];
}

// ── FAAB advisor output ─────────────────────────────────────────

export interface FaabBidSuggestion {
  player: {
    playerId: string;
    name: string;
    position: string;
    team: string | null;
  };
  suggestedBid: { min: number; max: number; recommended: number };
  confidence: number;
  reason: string;
  priority: 'must_bid' | 'strong_add' | 'depth_add' | 'speculative';
}

export interface FaabAdvice {
  budget: {
    total: number;
    spent: number;
    remaining: number;
    weeksPassed: number;
    weeksRemaining: number;
  };
  pacing: {
    weeklyBudget: number;
    status: 'under_spending' | 'on_track' | 'over_spending';
    recommendation: string;
  };
  bids: FaabBidSuggestion[];
}
