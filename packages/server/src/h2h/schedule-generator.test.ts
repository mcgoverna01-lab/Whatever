import { describe, it, expect } from 'vitest';
import { generateH2HSchedule, type H2HMatchup } from './schedule-generator.js';

describe('generateH2HSchedule', () => {
  it('generates correct number of matchups per gameweek for 8 teams', () => {
    const schedule = generateH2HSchedule(8, 10);
    const byGW = groupByGameweek(schedule);

    // 8 teams = 4 matches per gameweek
    for (const [, matchups] of byGW) {
      expect(matchups.length).toBe(4);
    }
  });

  it('every team plays exactly once per gameweek', () => {
    const schedule = generateH2HSchedule(8, 10);
    const byGW = groupByGameweek(schedule);

    for (const [, matchups] of byGW) {
      const playing = new Set<number>();
      for (const m of matchups) {
        expect(playing.has(m.homeIndex)).toBe(false);
        expect(playing.has(m.awayIndex)).toBe(false);
        playing.add(m.homeIndex);
        playing.add(m.awayIndex);
      }
      // All 8 teams play
      expect(playing.size).toBe(8);
    }
  });

  it('generates matchups for all gameweeks', () => {
    const schedule = generateH2HSchedule(8, 38);
    const byGW = groupByGameweek(schedule);

    // Should have matchups for each of the 38 gameweeks
    expect(byGW.size).toBe(38);
  });

  it('handles odd-numbered leagues (bye weeks)', () => {
    const schedule = generateH2HSchedule(7, 10);
    const byGW = groupByGameweek(schedule);

    // 7 teams = 3 matches per gameweek (one team has bye)
    for (const [, matchups] of byGW) {
      expect(matchups.length).toBe(3);

      // Only 6 of 7 teams play each week
      const playing = new Set<number>();
      for (const m of matchups) {
        playing.add(m.homeIndex);
        playing.add(m.awayIndex);
      }
      expect(playing.size).toBe(6);
    }
  });

  it('no team plays itself', () => {
    const schedule = generateH2HSchedule(8, 38);
    for (const m of schedule) {
      expect(m.homeIndex).not.toBe(m.awayIndex);
    }
  });

  it('all valid team indices', () => {
    const schedule = generateH2HSchedule(10, 20);
    for (const m of schedule) {
      expect(m.homeIndex).toBeGreaterThanOrEqual(0);
      expect(m.homeIndex).toBeLessThan(10);
      expect(m.awayIndex).toBeGreaterThanOrEqual(0);
      expect(m.awayIndex).toBeLessThan(10);
    }
  });

  it('rejects < 4 teams', () => {
    expect(() => generateH2HSchedule(3)).toThrow();
  });
});

function groupByGameweek(schedule: H2HMatchup[]): Map<number, H2HMatchup[]> {
  const map = new Map<number, H2HMatchup[]>();
  for (const m of schedule) {
    if (!map.has(m.gameweek)) map.set(m.gameweek, []);
    map.get(m.gameweek)!.push(m);
  }
  return map;
}
