/**
 * FPL-accurate scoring rules.
 * These match the official FPL scoring system by default,
 * but leagues can customize.
 */
export interface ScoringRules {
  id: string;
  name: string;

  // Appearance
  minutesForAppearance: number; // minutes needed for 1pt (default: 1)
  appearancePoints: number; // default: 1
  minutesFor60Bonus: number; // minutes needed for extra point (default: 60)
  sixtyMinutePoints: number; // default: 1

  // Goals
  goalPointsGKP: number; // default: 6
  goalPointsDEF: number; // default: 6
  goalPointsMID: number; // default: 5
  goalPointsFWD: number; // default: 4

  // Assists
  assistPoints: number; // default: 3

  // Clean sheets
  cleanSheetPointsGKP: number; // default: 4
  cleanSheetPointsDEF: number; // default: 4
  cleanSheetPointsMID: number; // default: 1
  cleanSheetPointsFWD: number; // default: 0

  // Conceding (per 2 goals conceded)
  goalsConcededThreshold: number; // default: 2
  goalsConcededPointsGKP: number; // default: -1
  goalsConcededPointsDEF: number; // default: -1

  // Saves (GKP only)
  savesForPoint: number; // default: 3
  savePoints: number; // default: 1

  // Penalties
  penaltySavePoints: number; // default: 5
  penaltyMissPoints: number; // default: -2

  // Cards
  yellowCardPoints: number; // default: -1
  redCardPoints: number; // default: -3

  // Own goals
  ownGoalPoints: number; // default: -2

  // Bonus (official BPS system)
  bonusEnabled: boolean; // default: true
}

export const FPL_DEFAULT_SCORING: ScoringRules = {
  id: 'fpl-default',
  name: 'FPL Official',
  minutesForAppearance: 1,
  appearancePoints: 1,
  minutesFor60Bonus: 60,
  sixtyMinutePoints: 1,
  goalPointsGKP: 6,
  goalPointsDEF: 6,
  goalPointsMID: 5,
  goalPointsFWD: 4,
  assistPoints: 3,
  cleanSheetPointsGKP: 4,
  cleanSheetPointsDEF: 4,
  cleanSheetPointsMID: 1,
  cleanSheetPointsFWD: 0,
  goalsConcededThreshold: 2,
  goalsConcededPointsGKP: -1,
  goalsConcededPointsDEF: -1,
  savesForPoint: 3,
  savePoints: 1,
  penaltySavePoints: 5,
  penaltyMissPoints: -2,
  yellowCardPoints: -1,
  redCardPoints: -3,
  ownGoalPoints: -2,
  bonusEnabled: true,
};

export interface GameweekPlayerScore {
  playerId: number;
  gameweek: number;
  minutes: number;
  goals: number;
  assists: number;
  cleanSheet: boolean;
  goalsConceded: number;
  saves: number;
  penaltiesSaved: number;
  penaltiesMissed: number;
  yellowCards: number;
  redCards: number;
  ownGoals: number;
  bonus: number;
  totalPoints: number;
}

export interface GameweekTeamScore {
  memberId: string;
  gameweek: number;
  startingPoints: number;
  benchPoints: number;
  totalPoints: number;
  /** Auto-sub events that occurred */
  autoSubs: AutoSub[];
}

export interface AutoSub {
  playerOut: number;
  playerIn: number;
  reason: 'did_not_play';
}
