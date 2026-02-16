/** FPL positions — matches official game */
export type Position = 'GKP' | 'DEF' | 'MID' | 'FWD';

/** PL club, 3-letter code */
export type ClubCode = string; // e.g. 'ARS', 'MCI', 'LIV'

export interface Player {
  id: number;
  fplId: number; // official FPL API element ID
  webName: string; // shirt name
  firstName: string;
  lastName: string;
  position: Position;
  clubCode: ClubCode;
  clubName: string;
  /** Current FPL price in tenths (e.g. 120 = £12.0m) */
  nowCost: number;
  /** Total FPL points this season */
  totalPoints: number;
  /** Points per game */
  pointsPerGame: number;
  /** Minutes played this season */
  minutes: number;
  /** Whether the player is available (not injured/suspended) */
  available: boolean;
  /** Injury/suspension news from FPL API */
  news: string | null;
  /** Chance of playing next round (0-100, null = unknown) */
  chanceOfPlayingNextRound: number | null;
}

/**
 * FPL squad constraints per official rules:
 * - 15 players total (11 starters + 4 bench)
 * - Max 3 from any single club
 * - 2 GKP, 5 DEF, 5 MID, 3 FWD
 *
 * Draft leagues relax budget but keep positional constraints.
 */
export const SQUAD_CONSTRAINTS = {
  maxSquadSize: 15,
  maxPerClub: 3,
  positions: {
    GKP: { min: 2, max: 2 },
    DEF: { min: 5, max: 5 },
    MID: { min: 5, max: 5 },
    FWD: { min: 3, max: 3 },
  },
} as const;

/**
 * Valid formations for starting XI.
 * Exactly 1 GKP + 10 outfield in these shapes.
 */
export const VALID_FORMATIONS: ReadonlyArray<[number, number, number]> = [
  [3, 4, 3],
  [3, 5, 2],
  [4, 3, 3],
  [4, 4, 2],
  [4, 5, 1],
  [5, 3, 2],
  [5, 4, 1],
];
