/**
 * Round-robin H2H schedule generator.
 *
 * Uses the circle method (polygon scheduling) to generate
 * a balanced round-robin tournament. Each member plays every
 * other member exactly once per cycle, then the cycle repeats
 * until we cover all 38 gameweeks.
 *
 * For an 8-team league:
 *   - 7 rounds per cycle (each team plays 7 others)
 *   - 38 gameweeks / 7 = 5.43 cycles → some opponents faced 6 times
 *
 * For odd-numbered leagues, we add a bye week for one team per round.
 */

export interface H2HMatchup {
  gameweek: number;
  homeIndex: number; // 0-based index into members array
  awayIndex: number;
}

/**
 * Generate a full-season H2H schedule.
 *
 * @param leagueSize Number of members
 * @param totalGameweeks Total gameweeks in the season (PL = 38)
 * @returns Array of matchups covering all gameweeks
 */
export function generateH2HSchedule(
  leagueSize: number,
  totalGameweeks: number = 38,
): H2HMatchup[] {
  if (leagueSize < 4) throw new Error('H2H requires at least 4 teams');

  // For odd leagues, add a phantom team (bye week)
  const effectiveSize = leagueSize % 2 === 0 ? leagueSize : leagueSize + 1;
  const matchups: H2HMatchup[] = [];

  // Circle method: fix team 0, rotate others
  // Generates (effectiveSize - 1) rounds per cycle
  const roundsPerCycle = effectiveSize - 1;

  let gameweek = 1;

  while (gameweek <= totalGameweeks) {
    for (let round = 0; round < roundsPerCycle && gameweek <= totalGameweeks; round++) {
      const roundMatchups = generateRound(effectiveSize, round);

      for (const [home, away] of roundMatchups) {
        // Skip matchups involving the phantom team (bye)
        if (home >= leagueSize || away >= leagueSize) continue;

        // Alternate home/away across cycles for fairness
        const cycleNum = Math.floor((gameweek - 1) / roundsPerCycle);
        const swap = cycleNum % 2 === 1;

        matchups.push({
          gameweek,
          homeIndex: swap ? away : home,
          awayIndex: swap ? home : away,
        });
      }

      gameweek++;
    }
  }

  return matchups;
}

/**
 * Circle method: for a given round, generate all pairings.
 * Team 0 is fixed; teams 1..n-1 rotate clockwise.
 */
function generateRound(n: number, round: number): [number, number][] {
  const pairs: [number, number][] = [];

  // Build the rotation array
  const rotation: number[] = [];
  for (let i = 1; i < n; i++) {
    rotation.push(i);
  }

  // Rotate by `round` positions
  const rotated = [
    ...rotation.slice(round),
    ...rotation.slice(0, round),
  ];

  // Team 0 plays the first in the rotation
  pairs.push([0, rotated[0]]);

  // Pair up the rest: i-th from start with i-th from end
  const half = (n - 2) / 2;
  for (let i = 0; i < half; i++) {
    pairs.push([rotated[i + 1], rotated[rotated.length - 1 - i]]);
  }

  return pairs;
}
