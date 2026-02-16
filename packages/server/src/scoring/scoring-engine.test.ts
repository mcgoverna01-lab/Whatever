import { describe, it, expect } from 'vitest';
import { calculatePlayerScore, processAutoSubs } from './scoring-engine.js';
import { FPL_DEFAULT_SCORING } from '@pitch-draft/shared';

describe('calculatePlayerScore', () => {
  it('scores a basic appearance (1-59 mins)', () => {
    const points = calculatePlayerScore({
      position: 'MID',
      minutes: 45,
      goals: 0,
      assists: 0,
      cleanSheet: false,
      goalsConceded: 0,
      saves: 0,
      penaltiesSaved: 0,
      penaltiesMissed: 0,
      yellowCards: 0,
      redCards: 0,
      ownGoals: 0,
      bonus: 0,
    });
    expect(points).toBe(1); // appearance only
  });

  it('scores 60+ minute appearance', () => {
    const points = calculatePlayerScore({
      position: 'MID',
      minutes: 90,
      goals: 0,
      assists: 0,
      cleanSheet: false,
      goalsConceded: 0,
      saves: 0,
      penaltiesSaved: 0,
      penaltiesMissed: 0,
      yellowCards: 0,
      redCards: 0,
      ownGoals: 0,
      bonus: 0,
    });
    expect(points).toBe(2); // 1 appearance + 1 sixty-min bonus
  });

  it('scores a midfielder goal correctly (5 pts)', () => {
    const points = calculatePlayerScore({
      position: 'MID',
      minutes: 90,
      goals: 1,
      assists: 0,
      cleanSheet: false,
      goalsConceded: 0,
      saves: 0,
      penaltiesSaved: 0,
      penaltiesMissed: 0,
      yellowCards: 0,
      redCards: 0,
      ownGoals: 0,
      bonus: 0,
    });
    expect(points).toBe(7); // 2 (appearance) + 5 (mid goal)
  });

  it('scores a defender goal correctly (6 pts)', () => {
    const points = calculatePlayerScore({
      position: 'DEF',
      minutes: 90,
      goals: 1,
      assists: 0,
      cleanSheet: true,
      goalsConceded: 0,
      saves: 0,
      penaltiesSaved: 0,
      penaltiesMissed: 0,
      yellowCards: 0,
      redCards: 0,
      ownGoals: 0,
      bonus: 0,
    });
    // 2 (appearance) + 6 (def goal) + 4 (clean sheet) = 12
    expect(points).toBe(12);
  });

  it('applies clean sheet only for 60+ minutes', () => {
    const points = calculatePlayerScore({
      position: 'DEF',
      minutes: 45,
      goals: 0,
      assists: 0,
      cleanSheet: true,
      goalsConceded: 0,
      saves: 0,
      penaltiesSaved: 0,
      penaltiesMissed: 0,
      yellowCards: 0,
      redCards: 0,
      ownGoals: 0,
      bonus: 0,
    });
    // 1 (appearance) + 0 (no CS because <60 mins)
    expect(points).toBe(1);
  });

  it('penalizes goals conceded for DEF/GKP', () => {
    const points = calculatePlayerScore({
      position: 'DEF',
      minutes: 90,
      goals: 0,
      assists: 0,
      cleanSheet: false,
      goalsConceded: 3,
      saves: 0,
      penaltiesSaved: 0,
      penaltiesMissed: 0,
      yellowCards: 0,
      redCards: 0,
      ownGoals: 0,
      bonus: 0,
    });
    // 2 (appearance) - 1 (floor(3/2) = 1 penalty) = 1
    expect(points).toBe(1);
  });

  it('scores GKP saves', () => {
    const points = calculatePlayerScore({
      position: 'GKP',
      minutes: 90,
      goals: 0,
      assists: 0,
      cleanSheet: true,
      goalsConceded: 0,
      saves: 7,
      penaltiesSaved: 0,
      penaltiesMissed: 0,
      yellowCards: 0,
      redCards: 0,
      ownGoals: 0,
      bonus: 0,
    });
    // 2 (appearance) + 4 (CS) + 2 (floor(7/3) = 2 save points) = 8
    expect(points).toBe(8);
  });

  it('applies yellow and red card penalties', () => {
    const points = calculatePlayerScore({
      position: 'MID',
      minutes: 90,
      goals: 1,
      assists: 0,
      cleanSheet: false,
      goalsConceded: 0,
      saves: 0,
      penaltiesSaved: 0,
      penaltiesMissed: 0,
      yellowCards: 1,
      redCards: 1,
      ownGoals: 0,
      bonus: 0,
    });
    // 2 + 5 - 1 (yellow) - 3 (red) = 3
    expect(points).toBe(3);
  });

  it('handles a big Haaland gameweek', () => {
    const points = calculatePlayerScore({
      position: 'FWD',
      minutes: 90,
      goals: 3,
      assists: 1,
      cleanSheet: false,
      goalsConceded: 0,
      saves: 0,
      penaltiesSaved: 0,
      penaltiesMissed: 0,
      yellowCards: 0,
      redCards: 0,
      ownGoals: 0,
      bonus: 3,
    });
    // 2 (appear) + 12 (3 goals * 4) + 3 (assist) + 3 (bonus) = 20
    expect(points).toBe(20);
  });
});

describe('processAutoSubs', () => {
  it('substitutes a non-playing starter with first eligible bench player', () => {
    const starters = [
      { playerId: 1, position: 'GKP', minutes: 90 },
      { playerId: 2, position: 'DEF', minutes: 90 },
      { playerId: 3, position: 'DEF', minutes: 90 },
      { playerId: 4, position: 'DEF', minutes: 0 }, // didn't play
      { playerId: 5, position: 'MID', minutes: 90 },
      { playerId: 6, position: 'MID', minutes: 90 },
      { playerId: 7, position: 'MID', minutes: 90 },
      { playerId: 8, position: 'MID', minutes: 90 },
      { playerId: 9, position: 'FWD', minutes: 90 },
      { playerId: 10, position: 'FWD', minutes: 90 },
      { playerId: 11, position: 'FWD', minutes: 90 },
    ];
    const bench = [
      { playerId: 12, position: 'GKP', minutes: 0, benchOrder: 0 },
      { playerId: 13, position: 'DEF', minutes: 90, benchOrder: 1 },
      { playerId: 14, position: 'MID', minutes: 45, benchOrder: 2 },
      { playerId: 15, position: 'FWD', minutes: 0, benchOrder: 3 },
    ];

    const subs = processAutoSubs(starters, bench);
    expect(subs).toEqual([
      { playerOut: 4, playerIn: 13, reason: 'did_not_play' },
    ]);
  });

  it('does not sub GKP with outfield player', () => {
    const starters = [
      { playerId: 1, position: 'GKP', minutes: 0 }, // GKP didn't play
      { playerId: 2, position: 'DEF', minutes: 90 },
      { playerId: 3, position: 'DEF', minutes: 90 },
      { playerId: 4, position: 'DEF', minutes: 90 },
      { playerId: 5, position: 'MID', minutes: 90 },
      { playerId: 6, position: 'MID', minutes: 90 },
      { playerId: 7, position: 'MID', minutes: 90 },
      { playerId: 8, position: 'MID', minutes: 90 },
      { playerId: 9, position: 'FWD', minutes: 90 },
      { playerId: 10, position: 'FWD', minutes: 90 },
      { playerId: 11, position: 'FWD', minutes: 90 },
    ];
    const bench = [
      { playerId: 12, position: 'GKP', minutes: 90, benchOrder: 0 },
      { playerId: 13, position: 'DEF', minutes: 90, benchOrder: 1 },
      { playerId: 14, position: 'MID', minutes: 45, benchOrder: 2 },
      { playerId: 15, position: 'FWD', minutes: 0, benchOrder: 3 },
    ];

    const subs = processAutoSubs(starters, bench);
    expect(subs).toEqual([
      { playerOut: 1, playerIn: 12, reason: 'did_not_play' },
    ]);
  });

  it('respects formation validity (won\'t go below 3 DEF)', () => {
    const starters = [
      { playerId: 1, position: 'GKP', minutes: 90 },
      { playerId: 2, position: 'DEF', minutes: 90 },
      { playerId: 3, position: 'DEF', minutes: 90 },
      { playerId: 4, position: 'DEF', minutes: 0 }, // only 3 DEF, one out
      { playerId: 5, position: 'MID', minutes: 90 },
      { playerId: 6, position: 'MID', minutes: 90 },
      { playerId: 7, position: 'MID', minutes: 90 },
      { playerId: 8, position: 'MID', minutes: 90 },
      { playerId: 9, position: 'FWD', minutes: 90 },
      { playerId: 10, position: 'FWD', minutes: 90 },
      { playerId: 11, position: 'FWD', minutes: 90 },
    ];
    const bench = [
      { playerId: 12, position: 'GKP', minutes: 0, benchOrder: 0 },
      // Only FWD on bench — can't replace DEF without going to 2 DEF (invalid)
      { playerId: 13, position: 'FWD', minutes: 90, benchOrder: 1 },
      { playerId: 14, position: 'DEF', minutes: 90, benchOrder: 2 },
      { playerId: 15, position: 'MID', minutes: 0, benchOrder: 3 },
    ];

    const subs = processAutoSubs(starters, bench);
    // Should skip the FWD (bench order 1) and use the DEF (bench order 2)
    expect(subs).toEqual([
      { playerOut: 4, playerIn: 14, reason: 'did_not_play' },
    ]);
  });

  it('returns empty array when all starters played', () => {
    const starters = Array.from({ length: 11 }, (_, i) => ({
      playerId: i + 1,
      position: i === 0 ? 'GKP' : i <= 4 ? 'DEF' : i <= 8 ? 'MID' : 'FWD',
      minutes: 90,
    }));
    const bench = [
      { playerId: 12, position: 'GKP', minutes: 0, benchOrder: 0 },
      { playerId: 13, position: 'DEF', minutes: 45, benchOrder: 1 },
      { playerId: 14, position: 'MID', minutes: 90, benchOrder: 2 },
      { playerId: 15, position: 'FWD', minutes: 0, benchOrder: 3 },
    ];

    const subs = processAutoSubs(starters, bench);
    expect(subs).toEqual([]);
  });
});
