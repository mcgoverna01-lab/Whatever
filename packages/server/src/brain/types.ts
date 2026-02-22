import type { Position } from '@pitch-draft/shared';

// ── FPL API response shapes ────────────────────────────────────

export interface FplBootstrapResponse {
  elements: FplElement[];
  teams: FplTeam[];
  events: FplEvent[];
  element_types: FplElementType[];
}

export interface FplElement {
  id: number;
  web_name: string;
  first_name: string;
  second_name: string;
  element_type: number;             // 1=GKP, 2=DEF, 3=MID, 4=FWD
  team: number;
  now_cost: number;                 // price in tenths (120 = £12.0m)
  total_points: number;
  points_per_game: string;
  form: string;                     // avg pts last 30 days
  ict_index: string;
  influence: string;
  creativity: string;
  threat: string;
  selected_by_percent: string;
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
  status: string;                   // a=available, d=doubtful, i=injured, s=suspended, u=unavailable
  news: string | null;
  chance_of_playing_this_round: number | null;
  chance_of_playing_next_round: number | null;
  ep_this: string | null;           // expected points this GW
  ep_next: string | null;           // expected points next GW
}

export interface FplTeam {
  id: number;
  name: string;
  short_name: string;
  strength: number;
  strength_overall_home: number;
  strength_overall_away: number;
  strength_attack_home: number;
  strength_attack_away: number;
  strength_defence_home: number;
  strength_defence_away: number;
}

export interface FplEvent {
  id: number;
  name: string;
  deadline_time: string;
  finished: boolean;
  is_current: boolean;
  is_next: boolean;
  is_previous: boolean;
}

export interface FplElementType {
  id: number;
  plural_name_short: string;
  singular_name_short: string;
}

export interface FplFixture {
  id: number;
  event: number | null;             // gameweek (null = TBC)
  team_h: number;
  team_a: number;
  team_h_difficulty: number;        // 1–5 FDR
  team_a_difficulty: number;
  finished: boolean;
}

export interface FplLiveResponse {
  elements: FplLiveElement[];
}

export interface FplLiveElement {
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

// ── Internal player model ───────────────────────────────────────

export interface FplPlayer {
  id: number;
  webName: string;
  firstName: string;
  lastName: string;
  position: Position;
  teamId: number;
  clubCode: string;
  clubName: string;
  nowCost: number;
  totalPoints: number;
  ppg: number;
  form: number;
  ictIndex: number;
  minutes: number;
  status: string;
  news: string | null;
  chanceOfPlayingThisRound: number | null;
  chanceOfPlayingNextRound: number | null;
  epThis: number | null;
  epNext: number | null;
}

export interface FplClub {
  id: number;
  name: string;
  shortName: string;
  strength: number;
  strengthAttackHome: number;
  strengthAttackAway: number;
  strengthDefenceHome: number;
  strengthDefenceAway: number;
}

export interface Fixture {
  id: number;
  gameweek: number | null;
  homeTeamId: number;
  awayTeamId: number;
  homeDifficulty: number;
  awayDifficulty: number;
  finished: boolean;
}

// ── Projection types ────────────────────────────────────────────

export interface PlayerProjection {
  playerId: number;
  name: string;
  position: Position;
  clubCode: string;
  ros: number;
  ppg: number;
  confidence: number;
  weeklyBreakdown?: Array<{
    gameweek: number;
    projected: number;
    fixtureCount: number;
    avgFdr: number;
  }>;
}

export interface ProjectionContext {
  currentGameweek: number;
  totalGameweeks: number;
  players: Map<number, FplPlayer>;
  clubs: Map<number, FplClub>;
  fixtures: Fixture[];
  recentStats: Map<number, Array<{ gameweek: number; totalPoints: number; minutes: number }>>;
}

// ── Roster for brain analysis ───────────────────────────────────

export interface BrainRoster {
  memberId: string;
  teamName: string;
  playerIds: number[];
  faabRemaining: number;
}

// ── Trade evaluation ────────────────────────────────────────────

export type TradeVerdict =
  | 'fair'
  | 'slightly_favors_a' | 'favors_a' | 'heavily_favors_a'
  | 'slightly_favors_b' | 'favors_b' | 'heavily_favors_b';

export interface TradeSideAnalysis {
  teamName: string;
  players: Array<{
    playerId: number;
    name: string;
    position: Position;
    clubCode: string;
    projectedROS: number;
    scarcityAdjusted: number;
    fixtureRun: number;
  }>;
  totalRaw: number;
  totalAdjusted: number;
  rosterImpact: string;
}

export interface TradeConstraintViolation {
  type: 'club_limit' | 'position_limit' | 'squad_size';
  message: string;
  side: 'a' | 'b';
}

export interface TradeEvaluation {
  valid: boolean;
  violations: TradeConstraintViolation[];
  verdict: TradeVerdict;
  fairnessScore: number;
  summary: string;
  sideA: TradeSideAnalysis;
  sideB: TradeSideAnalysis;
}

// ── Waiver recommendation ───────────────────────────────────────

export interface WaiverRecommendation {
  player: {
    playerId: number;
    name: string;
    position: Position;
    clubCode: string;
    form: number;
    fixtureRun: number;
  };
  projectedROS: number;
  improvementOver: {
    playerId: number;
    name: string;
    position: Position;
    projectedROS: number;
  } | null;
  netGain: number;
  reason: string;
  suggestedDrop: {
    playerId: number;
    name: string;
    position: Position;
    clubCode: string;
  } | null;
}

export interface WaiverAnalysis {
  rosterNeeds: Array<{
    position: Position;
    severity: 'low' | 'medium' | 'high';
    reason: string;
  }>;
  recommendations: WaiverRecommendation[];
}

// ── FAAB advisor ────────────────────────────────────────────────

export interface FaabBidSuggestion {
  player: {
    playerId: number;
    name: string;
    position: Position;
    clubCode: string;
    form: number;
  };
  suggestedBid: { min: number; max: number; recommended: number };
  confidence: number;
  reason: string;
  priority: 'must_bid' | 'strong_add' | 'depth_add' | 'speculative';
  estimatedCompetition: number;
}

export interface FaabAdvice {
  budget: {
    total: number;
    spent: number;
    remaining: number;
    gameweeksPassed: number;
    gameweeksRemaining: number;
  };
  pacing: {
    weeklyBudget: number;
    status: 'under_spending' | 'on_track' | 'over_spending';
    recommendation: string;
  };
  bids: FaabBidSuggestion[];
}
