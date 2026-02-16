/**
 * Snake draft order generator.
 *
 * In a snake draft, pick order reverses each round:
 *   Round 1: 1, 2, 3, 4, 5, 6, 7, 8
 *   Round 2: 8, 7, 6, 5, 4, 3, 2, 1
 *   Round 3: 1, 2, 3, 4, 5, 6, 7, 8
 *   ...
 *
 * This generates the full pick queue upfront — no runtime computation
 * needed during the draft. The queue is immutable once created.
 */

export interface QueueEntry {
  overallPick: number;
  round: number;
  pickInRound: number;
  memberIndex: number; // 0-based index into the members array
}

/**
 * Generate a complete snake draft queue.
 *
 * @param leagueSize - Number of managers in the league (4-16)
 * @param totalRounds - Number of draft rounds (default 15 for FPL)
 * @returns Ordered array of queue entries
 */
export function generateSnakeOrder(
  leagueSize: number,
  totalRounds: number = 15,
): QueueEntry[] {
  if (leagueSize < 2 || leagueSize > 16) {
    throw new Error(`Invalid league size: ${leagueSize}. Must be 2-16.`);
  }
  if (totalRounds < 1 || totalRounds > 30) {
    throw new Error(`Invalid total rounds: ${totalRounds}. Must be 1-30.`);
  }

  const queue: QueueEntry[] = [];
  let overallPick = 1;

  for (let round = 1; round <= totalRounds; round++) {
    const isEvenRound = round % 2 === 0;

    for (let pick = 1; pick <= leagueSize; pick++) {
      const memberIndex = isEvenRound
        ? leagueSize - pick // reverse for even rounds
        : pick - 1;         // forward for odd rounds

      queue.push({
        overallPick,
        round,
        pickInRound: pick,
        memberIndex,
      });

      overallPick++;
    }
  }

  return queue;
}

/**
 * Generate a linear (non-snake) draft order.
 * Same order every round. Used in some league formats.
 */
export function generateLinearOrder(
  leagueSize: number,
  totalRounds: number = 15,
): QueueEntry[] {
  const queue: QueueEntry[] = [];
  let overallPick = 1;

  for (let round = 1; round <= totalRounds; round++) {
    for (let pick = 1; pick <= leagueSize; pick++) {
      queue.push({
        overallPick,
        round,
        pickInRound: pick,
        memberIndex: pick - 1,
      });
      overallPick++;
    }
  }

  return queue;
}
