import { describe, it, expect } from 'vitest';
import { HeuristicEngine } from './heuristic.js';
import type { ProjectionContext, FplPlayer, FplClub, Fixture } from '../types.js';

// ── Test helpers ──────────────────────────────────────────────

function makePlayer(overrides: Partial<FplPlayer> = {}): FplPlayer {
  return {
    id: 100,
    webName: 'Salah',
    firstName: 'Mohamed',
    lastName: 'Salah',
    position: 'MID',
    teamId: 14,
    clubCode: 'LIV',
    clubName: 'Liverpool',
    nowCost: 130,
    totalPoints: 150,
    ppg: 7.5,
    form: 8.0,
    ictIndex: 200,
    minutes: 2100,
    status: 'a',
    news: null,
    chanceOfPlayingThisRound: null,
    chanceOfPlayingNextRound: null,
    epThis: 7.0,
    epNext: 7.5,
    ...overrides,
  };
}

function makeFixture(gw: number, homeTeam: number, awayTeam: number, homeDiff = 3, awayDiff = 3): Fixture {
  return {
    id: gw * 100 + homeTeam,
    gameweek: gw,
    homeTeamId: homeTeam,
    awayTeamId: awayTeam,
    homeDifficulty: homeDiff,
    awayDifficulty: awayDiff,
    finished: false,
  };
}

function makeContext(overrides: Partial<ProjectionContext> = {}): ProjectionContext {
  const player = makePlayer();
  const players = new Map<number, FplPlayer>([[player.id, player]]);

  // Create fixtures for remaining GWs (GW21-38 for teamId 14)
  const fixtures: Fixture[] = [];
  for (let gw = 21; gw <= 38; gw++) {
    fixtures.push(makeFixture(gw, 14, gw, 3, 3)); // Home games, FDR 3
  }

  return {
    currentGameweek: 20,
    totalGameweeks: 38,
    players,
    clubs: new Map<number, FplClub>(),
    fixtures,
    recentStats: new Map(),
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────

describe('HeuristicEngine', () => {
  const engine = new HeuristicEngine();

  describe('projectPlayer', () => {
    it('returns zero for unknown player', () => {
      const ctx = makeContext();
      const result = engine.projectPlayer(999, ctx);
      expect(result.ros).toBe(0);
      expect(result.ppg).toBe(0);
      expect(result.confidence).toBe(0);
      expect(result.name).toContain('Unknown');
    });

    it('returns zero when no gameweeks remaining', () => {
      const ctx = makeContext({ currentGameweek: 38 });
      const result = engine.projectPlayer(100, ctx);
      expect(result.ros).toBe(0);
    });

    it('projects a healthy midfielder with fixtures', () => {
      const ctx = makeContext();
      const result = engine.projectPlayer(100, ctx);

      expect(result.playerId).toBe(100);
      expect(result.name).toBe('Salah');
      expect(result.position).toBe('MID');
      expect(result.clubCode).toBe('LIV');
      expect(result.ros).toBeGreaterThan(0);
      expect(result.ppg).toBeGreaterThan(0);
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.weeklyBreakdown).toBeDefined();
      expect(result.weeklyBreakdown!.length).toBe(18); // GW21-38
    });

    it('applies FDR multiplier for easy fixtures', () => {
      const easyFixtures: Fixture[] = [];
      for (let gw = 21; gw <= 38; gw++) {
        easyFixtures.push(makeFixture(gw, 14, gw, 1, 1)); // FDR 1 = easiest
      }
      const ctx = makeContext({ fixtures: easyFixtures });
      const easy = engine.projectPlayer(100, ctx);

      const hardFixtures: Fixture[] = [];
      for (let gw = 21; gw <= 38; gw++) {
        hardFixtures.push(makeFixture(gw, 14, gw, 5, 5)); // FDR 5 = hardest
      }
      const ctx2 = makeContext({ fixtures: hardFixtures });
      const hard = engine.projectPlayer(100, ctx2);

      expect(easy.ros).toBeGreaterThan(hard.ros);
    });

    it('handles blank gameweeks (no fixtures)', () => {
      // Only give fixtures for half the GWs
      const fixtures: Fixture[] = [];
      for (let gw = 21; gw <= 29; gw++) {
        fixtures.push(makeFixture(gw, 14, gw));
      }
      // GW30-38: no fixtures = blank
      const ctx = makeContext({ fixtures });
      const result = engine.projectPlayer(100, ctx);

      const blankWeeks = result.weeklyBreakdown!.filter((w) => w.fixtureCount === 0);
      expect(blankWeeks.length).toBe(9);
      blankWeeks.forEach((w) => expect(w.projected).toBe(0));
    });

    it('handles double gameweeks (2 fixtures)', () => {
      const fixtures: Fixture[] = [];
      for (let gw = 21; gw <= 38; gw++) {
        fixtures.push(makeFixture(gw, 14, gw));
      }
      // Add a double in GW25
      fixtures.push(makeFixture(25, 99, 14, 2, 2));

      const ctx = makeContext({ fixtures });
      const result = engine.projectPlayer(100, ctx);

      const dgw = result.weeklyBreakdown!.find((w) => w.gameweek === 25);
      expect(dgw!.fixtureCount).toBe(2);
      const sgw = result.weeklyBreakdown!.find((w) => w.gameweek === 21);
      expect(dgw!.projected).toBeGreaterThan(sgw!.projected);
    });

    it('reduces projection for injured players', () => {
      const ctx = makeContext();
      const healthy = engine.projectPlayer(100, ctx);

      const injuredPlayer = makePlayer({ status: 'i', chanceOfPlayingNextRound: 25 });
      const ctxInjured = makeContext({
        players: new Map([[100, injuredPlayer]]),
      });
      const injured = engine.projectPlayer(100, ctxInjured);

      // Injured player's first week should be discounted
      expect(injured.ros).toBeLessThan(healthy.ros);
    });

    it('uses recent stats when available', () => {
      const recentStats = new Map([
        [100, [
          { gameweek: 18, totalPoints: 15, minutes: 90 },
          { gameweek: 19, totalPoints: 12, minutes: 90 },
          { gameweek: 20, totalPoints: 10, minutes: 90 },
        ]],
      ]);

      const ctx = makeContext({ recentStats });
      const withRecent = engine.projectPlayer(100, ctx);

      const ctxNoRecent = makeContext();
      const withoutRecent = engine.projectPlayer(100, ctxNoRecent);

      // Both should produce valid projections
      expect(withRecent.ros).toBeGreaterThan(0);
      expect(withoutRecent.ros).toBeGreaterThan(0);
      // Projections should differ since recent form is different
      expect(withRecent.ros).not.toBe(withoutRecent.ros);
    });
  });

  describe('getPositionalScarcity', () => {
    const ctx = makeContext();

    it('returns highest scarcity for FWD', () => {
      const fwd = engine.getPositionalScarcity('FWD', ctx);
      const def = engine.getPositionalScarcity('DEF', ctx);
      expect(fwd).toBeGreaterThan(def);
    });

    it('returns lowest scarcity for GKP', () => {
      const gkp = engine.getPositionalScarcity('GKP', ctx);
      const mid = engine.getPositionalScarcity('MID', ctx);
      expect(gkp).toBeLessThan(mid);
    });
  });

  describe('adjustForScarcity', () => {
    it('increases value for scarce positions', () => {
      const ctx = makeContext();
      const proj = engine.projectPlayer(100, ctx);
      const adjusted = engine.adjustForScarcity(proj, ctx);
      // MID scarcity is 1.15, so adjusted should be > raw
      expect(adjusted).toBeGreaterThan(proj.ros);
    });
  });
});
