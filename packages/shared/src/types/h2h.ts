export type ScoringMode = 'total_points' | 'h2h' | 'h2h_and_total';

export interface H2HFixture {
  id: string;
  leagueId: string;
  gameweek: number;
  homeMemberId: string;
  homeTeam: string;
  awayMemberId: string;
  awayTeam: string;
  homePoints: number | null;
  awayPoints: number | null;
  winner: 'home' | 'away' | 'draw' | null;
}

export interface H2HStanding {
  leagueId: string;
  memberId: string;
  teamName: string;
  gameweek: number;
  wins: number;
  draws: number;
  losses: number;
  /** H2H points: 3W + 1D */
  h2hPoints: number;
  /** Cumulative FPL total (tiebreaker) */
  totalScore: number;
  rank: number;
}
