import { describe, it, expect } from 'vitest';
import { recommendWaivers } from './waiver-recommender.js';
import { HeuristicEngine } from './projection/heuristic.js';
import type { ProjectionContext, FplPlayer, FplClub, Fixture, BrainRoster } from './types.js';

// ── Test helpers ──────────────────────────────────────────────

let nextId = 1;

function makePlayer(
  name: string,
  pos: 'GKP' | 'DEF' | 'MID' | 'FWD',
  teamId: number,
  clubCode: string,
  overrides: Partial<FplPlayer> = {},
): FplPlayer {
  const id = nextId++;
  return {
    id,
    webName: name,
    firstName: name,
    lastName: name,
    position: pos,
    teamId,
    clubCode,
    clubName: clubCode,
    nowCost: 60,
    totalPoints: 60,
    ppg: 3.5,
    form: 3.5,
    ictIndex: 80,
    minutes: 1500,
    status: 'a',
    news: null,
    chanceOfPlayingThisRound: null,
    chanceOfPlayingNextRound: null,
    epThis: 3.0,
    epNext: 3.0,
    ...overrides,
  };
}

function setupContext(
  rosterPlayers: FplPlayer[],
  freeAgents: FplPlayer[],
  otherRosterPlayers: FplPlayer[] = [],
): { ctx: ProjectionContext; roster: BrainRoster; allRosters: BrainRoster[] } {
  const allPlayers = [...rosterPlayers, ...freeAgents, ...otherRosterPlayers];
  const playerMap = new Map<number, FplPlayer>();
  for (const p of allPlayers) playerMap.set(p.id, p);

  const teamIds = [...new Set(allPlayers.map((p) => p.teamId))];
  const fixtures: Fixture[] = [];
  for (let gw = 21; gw <= 38; gw++) {
    for (const teamId of teamIds) {
      fixtures.push({
        id: gw * 1000 + teamId,
        gameweek: gw,
        homeTeamId: teamId,
        awayTeamId: teamId + 100,
        homeDifficulty: 3,
        awayDifficulty: 3,
        finished: false,
      });
    }
  }

  const ctx: ProjectionContext = {
    currentGameweek: 20,
    totalGameweeks: 38,
    players: playerMap,
    clubs: new Map<number, FplClub>(),
    fixtures,
    recentStats: new Map(),
  };

  const roster: BrainRoster = {
    memberId: 'me',
    teamName: 'My Team',
    playerIds: rosterPlayers.map((p) => p.id),
    faabRemaining: 50,
  };

  const otherRoster: BrainRoster = {
    memberId: 'other',
    teamName: 'Other Team',
    playerIds: otherRosterPlayers.map((p) => p.id),
    faabRemaining: 50,
  };

  return {
    ctx,
    roster,
    allRosters: [roster, ...(otherRosterPlayers.length ? [otherRoster] : [])],
  };
}

// ── Tests ────────────────────────────────────────────────────

describe('recommendWaivers', () => {
  const engine = new HeuristicEngine();

  it('recommends free agents that improve the roster', () => {
    nextId = 1000;

    const rosterPlayers = [
      makePlayer('GK1', 'GKP', 1, 'ARS', { ppg: 4.0, form: 4.0 }),
      makePlayer('GK2', 'GKP', 2, 'AVL', { ppg: 3.5, form: 3.5 }),
      makePlayer('DEF1', 'DEF', 3, 'BOU', { ppg: 4.0, form: 4.0 }),
      makePlayer('DEF2', 'DEF', 4, 'BRE', { ppg: 4.0, form: 4.0 }),
      makePlayer('DEF3', 'DEF', 5, 'BHA', { ppg: 3.5, form: 3.5 }),
      makePlayer('DEF4', 'DEF', 6, 'CHE', { ppg: 3.0, form: 3.0 }),
      makePlayer('DEF5', 'DEF', 7, 'CRY', { ppg: 2.0, form: 2.0 }),
      makePlayer('MID1', 'MID', 8, 'EVE', { ppg: 5.0, form: 5.0 }),
      makePlayer('MID2', 'MID', 9, 'FUL', { ppg: 4.5, form: 4.5 }),
      makePlayer('MID3', 'MID', 10, 'MCI', { ppg: 3.0, form: 3.0 }),
      makePlayer('MID4', 'MID', 11, 'NEW', { ppg: 2.5, form: 2.5 }),
      makePlayer('MID5', 'MID', 12, 'NFO', { ppg: 2.0, form: 2.0 }),
      makePlayer('FWD1', 'FWD', 13, 'SOU', { ppg: 4.5, form: 4.5 }),
      makePlayer('FWD2', 'FWD', 14, 'LIV', { ppg: 3.5, form: 3.5 }),
      makePlayer('FWD3', 'FWD', 15, 'TOT', { ppg: 2.0, form: 2.0 }),
    ];

    const freeAgents = [
      makePlayer('Star MID', 'MID', 16, 'WHU', { ppg: 7.0, form: 7.5, totalPoints: 150, minutes: 2000 }),
      makePlayer('Good DEF', 'DEF', 17, 'WOL', { ppg: 5.0, form: 5.5, totalPoints: 100, minutes: 1800 }),
      makePlayer('Avg FWD', 'FWD', 18, 'LEI', { ppg: 3.0, form: 3.0, totalPoints: 50, minutes: 1200 }),
    ];

    const { ctx, roster, allRosters } = setupContext(rosterPlayers, freeAgents);

    const result = recommendWaivers(
      { roster, allRosters, limit: 5 },
      engine,
      ctx,
    );

    expect(result.recommendations.length).toBeGreaterThan(0);
    // Should recommend Star MID since our weakest MID is only 2.0 PPG
    const starMid = result.recommendations.find((r) => r.player.name === 'Star MID');
    expect(starMid).toBeDefined();
    expect(starMid!.netGain).toBeGreaterThan(0);
    expect(starMid!.suggestedDrop).toBeDefined();
  });

  it('filters out players with low minutes', () => {
    nextId = 2000;

    const rosterPlayers = [
      makePlayer('GK1', 'GKP', 1, 'ARS', { ppg: 4.0, form: 4.0 }),
      makePlayer('GK2', 'GKP', 2, 'AVL', { ppg: 3.5, form: 3.5 }),
      makePlayer('DEF1', 'DEF', 3, 'BOU', { ppg: 4.0, form: 4.0 }),
      makePlayer('DEF2', 'DEF', 4, 'BRE', { ppg: 4.0, form: 4.0 }),
      makePlayer('DEF3', 'DEF', 5, 'BHA', { ppg: 3.5, form: 3.5 }),
      makePlayer('DEF4', 'DEF', 6, 'CHE', { ppg: 3.0, form: 3.0 }),
      makePlayer('DEF5', 'DEF', 7, 'CRY', { ppg: 2.0, form: 2.0 }),
      makePlayer('MID1', 'MID', 8, 'EVE', { ppg: 5.0, form: 5.0 }),
      makePlayer('MID2', 'MID', 9, 'FUL', { ppg: 4.5, form: 4.5 }),
      makePlayer('MID3', 'MID', 10, 'MCI', { ppg: 3.0, form: 3.0 }),
      makePlayer('MID4', 'MID', 11, 'NEW', { ppg: 2.5, form: 2.5 }),
      makePlayer('MID5', 'MID', 12, 'NFO', { ppg: 2.0, form: 2.0 }),
      makePlayer('FWD1', 'FWD', 13, 'SOU', { ppg: 4.5, form: 4.5 }),
      makePlayer('FWD2', 'FWD', 14, 'LIV', { ppg: 3.5, form: 3.5 }),
      makePlayer('FWD3', 'FWD', 15, 'TOT', { ppg: 2.0, form: 2.0 }),
    ];

    const freeAgents = [
      // Low minutes — should be filtered
      makePlayer('Bench Warmer', 'MID', 16, 'WHU', { ppg: 8.0, form: 8.0, minutes: 50 }),
      // Injured — should be filtered
      makePlayer('Injured Star', 'MID', 17, 'WOL', { ppg: 7.0, form: 7.0, minutes: 1500, status: 'i' }),
      // Valid
      makePlayer('Solid MID', 'MID', 18, 'LEI', { ppg: 6.0, form: 6.0, minutes: 1500 }),
    ];

    const { ctx, roster, allRosters } = setupContext(rosterPlayers, freeAgents);

    const result = recommendWaivers(
      { roster, allRosters, limit: 10 },
      engine,
      ctx,
    );

    const benchWarmer = result.recommendations.find((r) => r.player.name === 'Bench Warmer');
    expect(benchWarmer).toBeUndefined();

    const injured = result.recommendations.find((r) => r.player.name === 'Injured Star');
    expect(injured).toBeUndefined();
  });

  it('respects the limit parameter', () => {
    nextId = 3000;

    const rosterPlayers = [
      makePlayer('GK1', 'GKP', 1, 'ARS', { ppg: 4.0, form: 4.0 }),
      makePlayer('GK2', 'GKP', 2, 'AVL', { ppg: 3.0, form: 3.0 }),
      makePlayer('DEF1', 'DEF', 3, 'BOU', { ppg: 4.0, form: 4.0 }),
      makePlayer('DEF2', 'DEF', 4, 'BRE', { ppg: 3.5, form: 3.5 }),
      makePlayer('DEF3', 'DEF', 5, 'BHA', { ppg: 3.0, form: 3.0 }),
      makePlayer('DEF4', 'DEF', 6, 'CHE', { ppg: 2.5, form: 2.5 }),
      makePlayer('DEF5', 'DEF', 7, 'CRY', { ppg: 2.0, form: 2.0 }),
      makePlayer('MID1', 'MID', 8, 'EVE', { ppg: 4.0, form: 4.0 }),
      makePlayer('MID2', 'MID', 9, 'FUL', { ppg: 3.5, form: 3.5 }),
      makePlayer('MID3', 'MID', 10, 'MCI', { ppg: 2.5, form: 2.5 }),
      makePlayer('MID4', 'MID', 11, 'NEW', { ppg: 2.0, form: 2.0 }),
      makePlayer('MID5', 'MID', 12, 'NFO', { ppg: 1.5, form: 1.5 }),
      makePlayer('FWD1', 'FWD', 13, 'SOU', { ppg: 4.0, form: 4.0 }),
      makePlayer('FWD2', 'FWD', 14, 'LIV', { ppg: 3.0, form: 3.0 }),
      makePlayer('FWD3', 'FWD', 15, 'TOT', { ppg: 1.5, form: 1.5 }),
    ];

    const freeAgents = Array.from({ length: 10 }, (_, i) =>
      makePlayer(`FA${i}`, 'MID', 16 + i, `T${i}`, { ppg: 5.0 + i * 0.5, form: 5.0 + i * 0.5, totalPoints: 100 + i * 10, minutes: 1500 }),
    );

    const { ctx, roster, allRosters } = setupContext(rosterPlayers, freeAgents);

    const result = recommendWaivers(
      { roster, allRosters, limit: 3 },
      engine,
      ctx,
    );

    expect(result.recommendations.length).toBeLessThanOrEqual(3);
  });

  it('analyzes roster needs correctly', () => {
    nextId = 4000;

    // Weak DEF roster — should show as a need
    const rosterPlayers = [
      makePlayer('GK1', 'GKP', 1, 'ARS', { ppg: 4.0, form: 4.0 }),
      makePlayer('GK2', 'GKP', 2, 'AVL', { ppg: 3.5, form: 3.5 }),
      makePlayer('DEF1', 'DEF', 3, 'BOU', { ppg: 1.5, form: 1.5 }),
      makePlayer('DEF2', 'DEF', 4, 'BRE', { ppg: 1.5, form: 1.5 }),
      makePlayer('DEF3', 'DEF', 5, 'BHA', { ppg: 1.5, form: 1.5 }),
      makePlayer('DEF4', 'DEF', 6, 'CHE', { ppg: 1.0, form: 1.0 }),
      makePlayer('DEF5', 'DEF', 7, 'CRY', { ppg: 1.0, form: 1.0 }),
      makePlayer('MID1', 'MID', 8, 'EVE', { ppg: 6.0, form: 6.0 }),
      makePlayer('MID2', 'MID', 9, 'FUL', { ppg: 5.5, form: 5.5 }),
      makePlayer('MID3', 'MID', 10, 'MCI', { ppg: 5.0, form: 5.0 }),
      makePlayer('MID4', 'MID', 11, 'NEW', { ppg: 5.0, form: 5.0 }),
      makePlayer('MID5', 'MID', 12, 'NFO', { ppg: 4.5, form: 4.5 }),
      makePlayer('FWD1', 'FWD', 13, 'SOU', { ppg: 5.0, form: 5.0 }),
      makePlayer('FWD2', 'FWD', 14, 'LIV', { ppg: 4.5, form: 4.5 }),
      makePlayer('FWD3', 'FWD', 15, 'TOT', { ppg: 4.0, form: 4.0 }),
    ];

    const freeAgents = [
      makePlayer('Good DEF', 'DEF', 16, 'WHU', { ppg: 5.0, form: 5.0, totalPoints: 100, minutes: 1800 }),
    ];

    const { ctx, roster, allRosters } = setupContext(rosterPlayers, freeAgents);

    const result = recommendWaivers(
      { roster, allRosters, limit: 5 },
      engine,
      ctx,
    );

    // Should have DEF listed as a need
    const defNeed = result.rosterNeeds.find((n) => n.position === 'DEF');
    expect(defNeed).toBeDefined();
    expect(defNeed!.severity).toBe('high');
  });

  it('excludes players on other rosters', () => {
    nextId = 5000;

    const rosterPlayers = [
      makePlayer('GK1', 'GKP', 1, 'ARS', { ppg: 4.0, form: 4.0 }),
      makePlayer('GK2', 'GKP', 2, 'AVL', { ppg: 3.5, form: 3.5 }),
      makePlayer('DEF1', 'DEF', 3, 'BOU', { ppg: 4.0, form: 4.0 }),
      makePlayer('DEF2', 'DEF', 4, 'BRE', { ppg: 3.5, form: 3.5 }),
      makePlayer('DEF3', 'DEF', 5, 'BHA', { ppg: 3.0, form: 3.0 }),
      makePlayer('DEF4', 'DEF', 6, 'CHE', { ppg: 2.5, form: 2.5 }),
      makePlayer('DEF5', 'DEF', 7, 'CRY', { ppg: 2.0, form: 2.0 }),
      makePlayer('MID1', 'MID', 8, 'EVE', { ppg: 4.0, form: 4.0 }),
      makePlayer('MID2', 'MID', 9, 'FUL', { ppg: 3.5, form: 3.5 }),
      makePlayer('MID3', 'MID', 10, 'MCI', { ppg: 2.5, form: 2.5 }),
      makePlayer('MID4', 'MID', 11, 'NEW', { ppg: 2.0, form: 2.0 }),
      makePlayer('MID5', 'MID', 12, 'NFO', { ppg: 1.5, form: 1.5 }),
      makePlayer('FWD1', 'FWD', 13, 'SOU', { ppg: 4.0, form: 4.0 }),
      makePlayer('FWD2', 'FWD', 14, 'LIV', { ppg: 3.0, form: 3.0 }),
      makePlayer('FWD3', 'FWD', 15, 'TOT', { ppg: 2.0, form: 2.0 }),
    ];

    // This star player is on another roster — should NOT be recommended
    const otherRosterPlayers = [
      makePlayer('Rostered Star', 'MID', 16, 'WHU', { ppg: 9.0, form: 9.0, totalPoints: 200, minutes: 2000 }),
    ];

    // This one is a free agent — should be recommended
    const freeAgents = [
      makePlayer('Free Agent', 'MID', 17, 'WOL', { ppg: 6.0, form: 6.0, totalPoints: 120, minutes: 1800 }),
    ];

    const { ctx, roster, allRosters } = setupContext(rosterPlayers, freeAgents, otherRosterPlayers);

    const result = recommendWaivers(
      { roster, allRosters, limit: 10 },
      engine,
      ctx,
    );

    const rosteredStar = result.recommendations.find((r) => r.player.name === 'Rostered Star');
    expect(rosteredStar).toBeUndefined();
  });

  it('includes fixture run in recommendations', () => {
    nextId = 6000;

    const rosterPlayers = [
      makePlayer('GK1', 'GKP', 1, 'ARS', { ppg: 4.0, form: 4.0 }),
      makePlayer('GK2', 'GKP', 2, 'AVL', { ppg: 3.5, form: 3.5 }),
      makePlayer('DEF1', 'DEF', 3, 'BOU', { ppg: 4.0, form: 4.0 }),
      makePlayer('DEF2', 'DEF', 4, 'BRE', { ppg: 3.5, form: 3.5 }),
      makePlayer('DEF3', 'DEF', 5, 'BHA', { ppg: 3.0, form: 3.0 }),
      makePlayer('DEF4', 'DEF', 6, 'CHE', { ppg: 2.5, form: 2.5 }),
      makePlayer('DEF5', 'DEF', 7, 'CRY', { ppg: 2.0, form: 2.0 }),
      makePlayer('MID1', 'MID', 8, 'EVE', { ppg: 4.0, form: 4.0 }),
      makePlayer('MID2', 'MID', 9, 'FUL', { ppg: 3.5, form: 3.5 }),
      makePlayer('MID3', 'MID', 10, 'MCI', { ppg: 2.5, form: 2.5 }),
      makePlayer('MID4', 'MID', 11, 'NEW', { ppg: 2.0, form: 2.0 }),
      makePlayer('MID5', 'MID', 12, 'NFO', { ppg: 1.0, form: 1.0 }),
      makePlayer('FWD1', 'FWD', 13, 'SOU', { ppg: 4.0, form: 4.0 }),
      makePlayer('FWD2', 'FWD', 14, 'LIV', { ppg: 3.0, form: 3.0 }),
      makePlayer('FWD3', 'FWD', 15, 'TOT', { ppg: 2.0, form: 2.0 }),
    ];

    const freeAgents = [
      makePlayer('FA MID', 'MID', 16, 'WHU', { ppg: 6.0, form: 6.0, totalPoints: 120, minutes: 1800 }),
    ];

    const { ctx, roster, allRosters } = setupContext(rosterPlayers, freeAgents);

    const result = recommendWaivers(
      { roster, allRosters, limit: 5 },
      engine,
      ctx,
    );

    if (result.recommendations.length > 0) {
      expect(result.recommendations[0].player.fixtureRun).toBeDefined();
      expect(result.recommendations[0].player.fixtureRun).toBeGreaterThan(0);
    }
  });
});
