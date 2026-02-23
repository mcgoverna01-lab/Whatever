import { describe, it, expect } from 'vitest';
import { adviseFaab } from './faab-advisor.js';
import { HeuristicEngine } from './projection/heuristic.js';
import type { ProjectionContext, FplPlayer, FplClub, Fixture, BrainRoster } from './types.js';

// ── Test helpers ──────────────────────────────────────────────

let nextId = 7000;

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

function makeRoster(
  rosterPlayers: FplPlayer[],
  freeAgents: FplPlayer[],
  opts: { faab?: number; currentGw?: number; otherRosters?: Array<{ players: FplPlayer[]; faab: number }> } = {},
): { ctx: ProjectionContext; roster: BrainRoster; allRosters: BrainRoster[] } {
  const otherRosterPlayers = (opts.otherRosters ?? []).flatMap((r) => r.players);
  const allPlayers = [...rosterPlayers, ...freeAgents, ...otherRosterPlayers];
  const playerMap = new Map<number, FplPlayer>();
  for (const p of allPlayers) playerMap.set(p.id, p);

  const teamIds = [...new Set(allPlayers.map((p) => p.teamId))];
  const fixtures: Fixture[] = [];
  const currentGw = opts.currentGw ?? 20;
  for (let gw = currentGw + 1; gw <= 38; gw++) {
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
    currentGameweek: currentGw,
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
    faabRemaining: opts.faab ?? 50,
  };

  const allRosters: BrainRoster[] = [roster];
  (opts.otherRosters ?? []).forEach((r, i) => {
    allRosters.push({
      memberId: `other-${i}`,
      teamName: `Other Team ${i}`,
      playerIds: r.players.map((p) => p.id),
      faabRemaining: r.faab,
    });
  });

  return { ctx, roster, allRosters };
}

function makeStandardRoster(): FplPlayer[] {
  return [
    makePlayer('GK1', 'GKP', 1, 'ARS', { ppg: 4.0, form: 4.0 }),
    makePlayer('GK2', 'GKP', 2, 'AVL', { ppg: 3.0, form: 3.0 }),
    makePlayer('DEF1', 'DEF', 3, 'BOU', { ppg: 4.0, form: 4.0 }),
    makePlayer('DEF2', 'DEF', 4, 'BRE', { ppg: 3.5, form: 3.5 }),
    makePlayer('DEF3', 'DEF', 5, 'BHA', { ppg: 3.0, form: 3.0 }),
    makePlayer('DEF4', 'DEF', 6, 'CHE', { ppg: 2.5, form: 2.5 }),
    makePlayer('DEF5', 'DEF', 7, 'CRY', { ppg: 2.0, form: 2.0 }),
    makePlayer('MID1', 'MID', 8, 'EVE', { ppg: 5.0, form: 5.0 }),
    makePlayer('MID2', 'MID', 9, 'FUL', { ppg: 4.0, form: 4.0 }),
    makePlayer('MID3', 'MID', 10, 'MCI', { ppg: 3.0, form: 3.0 }),
    makePlayer('MID4', 'MID', 11, 'NEW', { ppg: 2.5, form: 2.5 }),
    makePlayer('MID5', 'MID', 12, 'NFO', { ppg: 2.0, form: 2.0 }),
    makePlayer('FWD1', 'FWD', 13, 'SOU', { ppg: 4.5, form: 4.5 }),
    makePlayer('FWD2', 'FWD', 14, 'LIV', { ppg: 3.5, form: 3.5 }),
    makePlayer('FWD3', 'FWD', 15, 'TOT', { ppg: 2.0, form: 2.0 }),
  ];
}

// ── Tests ────────────────────────────────────────────────────

describe('adviseFaab', () => {
  const engine = new HeuristicEngine();

  it('returns budget pacing information', () => {
    nextId = 7000;

    const rosterPlayers = makeStandardRoster();
    const freeAgents = [
      makePlayer('Star MID', 'MID', 16, 'WHU', { ppg: 7.0, form: 7.0, totalPoints: 150, minutes: 2000 }),
    ];

    const { ctx, roster, allRosters } = makeRoster(rosterPlayers, freeAgents, { faab: 50 });

    const result = adviseFaab(
      { roster, allRosters, totalBudget: 100, limit: 5 },
      engine,
      ctx,
    );

    expect(result.budget).toBeDefined();
    expect(result.budget.total).toBe(100);
    expect(result.budget.remaining).toBe(50);
    expect(result.budget.spent).toBe(50);
    expect(result.budget.gameweeksRemaining).toBeGreaterThan(0);
    expect(result.pacing).toBeDefined();
    expect(['under_spending', 'on_track', 'over_spending']).toContain(result.pacing.status);
    expect(result.pacing.weeklyBudget).toBeGreaterThan(0);
    expect(result.pacing.recommendation).toBeTruthy();
  });

  it('generates bid suggestions with min/max/recommended ranges', () => {
    nextId = 8000;

    const rosterPlayers = makeStandardRoster();
    const freeAgents = [
      makePlayer('Good MID', 'MID', 16, 'WHU', { ppg: 6.5, form: 7.0, totalPoints: 130, minutes: 1800 }),
      makePlayer('Good DEF', 'DEF', 17, 'WOL', { ppg: 5.0, form: 5.5, totalPoints: 100, minutes: 1700 }),
    ];

    const { ctx, roster, allRosters } = makeRoster(rosterPlayers, freeAgents, { faab: 60 });

    const result = adviseFaab(
      { roster, allRosters, totalBudget: 100, limit: 5 },
      engine,
      ctx,
    );

    expect(result.bids.length).toBeGreaterThan(0);

    for (const bid of result.bids) {
      expect(bid.suggestedBid.min).toBeGreaterThanOrEqual(1);
      expect(bid.suggestedBid.max).toBeGreaterThanOrEqual(bid.suggestedBid.min);
      expect(bid.suggestedBid.recommended).toBeGreaterThanOrEqual(bid.suggestedBid.min);
      expect(bid.suggestedBid.recommended).toBeLessThanOrEqual(bid.suggestedBid.max);
      // Never suggest more than remaining budget
      expect(bid.suggestedBid.max).toBeLessThanOrEqual(60);
    }
  });

  it('classifies bid priority correctly', () => {
    nextId = 9000;

    const rosterPlayers = makeStandardRoster();
    const freeAgents = [
      // Huge upgrade — should be must_bid or strong_add
      makePlayer('Elite MID', 'MID', 16, 'WHU', { ppg: 9.0, form: 9.0, totalPoints: 200, minutes: 2000 }),
      // Minor upgrade — should be depth_add or speculative
      makePlayer('Avg MID', 'MID', 17, 'WOL', { ppg: 3.5, form: 3.5, totalPoints: 60, minutes: 1500 }),
    ];

    const { ctx, roster, allRosters } = makeRoster(rosterPlayers, freeAgents, { faab: 80 });

    const result = adviseFaab(
      { roster, allRosters, totalBudget: 100, limit: 5 },
      engine,
      ctx,
    );

    const validPriorities = ['must_bid', 'strong_add', 'depth_add', 'speculative'];
    for (const bid of result.bids) {
      expect(validPriorities).toContain(bid.priority);
    }

    // Elite MID should rank higher in priority
    if (result.bids.length >= 2) {
      const eliteBid = result.bids.find((b) => b.player.name === 'Elite MID');
      expect(eliteBid).toBeDefined();
      expect(['must_bid', 'strong_add']).toContain(eliteBid!.priority);
    }
  });

  it('respects the limit parameter', () => {
    nextId = 10000;

    const rosterPlayers = makeStandardRoster();
    const freeAgents = Array.from({ length: 10 }, (_, i) =>
      makePlayer(`FA${i}`, 'MID', 16 + i, `T${i}`, { ppg: 5.0 + i * 0.3, form: 5.0 + i * 0.3, totalPoints: 100, minutes: 1500 }),
    );

    const { ctx, roster, allRosters } = makeRoster(rosterPlayers, freeAgents, { faab: 70 });

    const result = adviseFaab(
      { roster, allRosters, totalBudget: 100, limit: 3 },
      engine,
      ctx,
    );

    expect(result.bids.length).toBeLessThanOrEqual(3);
  });

  it('detects under-spending when FAAB is barely used', () => {
    nextId = 11000;

    const rosterPlayers = makeStandardRoster();
    const freeAgents = [
      makePlayer('FA MID', 'MID', 16, 'WHU', { ppg: 6.0, form: 6.0, totalPoints: 120, minutes: 1800 }),
    ];

    // Late in the season (GW30) with nearly full budget — under-spending
    const { ctx, roster, allRosters } = makeRoster(rosterPlayers, freeAgents, { faab: 95, currentGw: 30 });

    const result = adviseFaab(
      { roster, allRosters, totalBudget: 100, limit: 5 },
      engine,
      ctx,
    );

    expect(result.pacing.status).toBe('under_spending');
    expect(result.pacing.recommendation).toContain('aggressive');
  });

  it('detects over-spending when FAAB is nearly gone early', () => {
    nextId = 12000;

    const rosterPlayers = makeStandardRoster();
    const freeAgents = [
      makePlayer('FA MID', 'MID', 16, 'WHU', { ppg: 6.0, form: 6.0, totalPoints: 120, minutes: 1800 }),
    ];

    // Early in the season (GW10) with most budget spent — over-spending
    const { ctx, roster, allRosters } = makeRoster(rosterPlayers, freeAgents, { faab: 10, currentGw: 10 });

    const result = adviseFaab(
      { roster, allRosters, totalBudget: 100, limit: 5 },
      engine,
      ctx,
    );

    expect(result.pacing.status).toBe('over_spending');
    expect(result.pacing.recommendation).toContain('Tighten');
  });

  it('includes competition estimates from league-wide demand', () => {
    nextId = 13000;

    const rosterPlayers = makeStandardRoster();

    // Other teams with weak DEF — drives up DEF demand
    const otherTeam1Players = [
      makePlayer('OGK1', 'GKP', 20, 'T20', { ppg: 4.0, form: 4.0 }),
      makePlayer('OGK2', 'GKP', 21, 'T21', { ppg: 3.0, form: 3.0 }),
      makePlayer('ODEF1', 'DEF', 22, 'T22', { ppg: 1.0, form: 1.0 }),
      makePlayer('ODEF2', 'DEF', 23, 'T23', { ppg: 1.0, form: 1.0 }),
      makePlayer('ODEF3', 'DEF', 24, 'T24', { ppg: 1.0, form: 1.0 }),
      makePlayer('ODEF4', 'DEF', 25, 'T25', { ppg: 0.5, form: 0.5 }),
      makePlayer('ODEF5', 'DEF', 26, 'T26', { ppg: 0.5, form: 0.5 }),
      makePlayer('OMID1', 'MID', 27, 'T27', { ppg: 5.0, form: 5.0 }),
      makePlayer('OMID2', 'MID', 28, 'T28', { ppg: 4.5, form: 4.5 }),
      makePlayer('OMID3', 'MID', 29, 'T29', { ppg: 4.0, form: 4.0 }),
      makePlayer('OMID4', 'MID', 30, 'T30', { ppg: 3.5, form: 3.5 }),
      makePlayer('OMID5', 'MID', 31, 'T31', { ppg: 3.0, form: 3.0 }),
      makePlayer('OFWD1', 'FWD', 32, 'T32', { ppg: 4.0, form: 4.0 }),
      makePlayer('OFWD2', 'FWD', 33, 'T33', { ppg: 3.5, form: 3.5 }),
      makePlayer('OFWD3', 'FWD', 34, 'T34', { ppg: 3.0, form: 3.0 }),
    ];

    const freeAgents = [
      makePlayer('Good DEF', 'DEF', 35, 'T35', { ppg: 5.0, form: 5.5, totalPoints: 100, minutes: 1800 }),
    ];

    const { ctx, roster, allRosters } = makeRoster(rosterPlayers, freeAgents, {
      faab: 50,
      otherRosters: [{ players: otherTeam1Players, faab: 60 }],
    });

    const result = adviseFaab(
      { roster, allRosters, totalBudget: 100, limit: 5 },
      engine,
      ctx,
    );

    for (const bid of result.bids) {
      expect(bid.estimatedCompetition).toBeDefined();
      expect(bid.estimatedCompetition).toBeGreaterThanOrEqual(0);
    }
  });

  it('includes player info and reason in bid suggestions', () => {
    nextId = 14000;

    const rosterPlayers = makeStandardRoster();
    const freeAgents = [
      makePlayer('Target MID', 'MID', 16, 'WHU', { ppg: 7.0, form: 7.0, totalPoints: 150, minutes: 2000 }),
    ];

    const { ctx, roster, allRosters } = makeRoster(rosterPlayers, freeAgents, { faab: 50 });

    const result = adviseFaab(
      { roster, allRosters, totalBudget: 100, limit: 5 },
      engine,
      ctx,
    );

    expect(result.bids.length).toBeGreaterThan(0);
    const bid = result.bids[0];

    expect(bid.player.name).toBeTruthy();
    expect(bid.player.position).toBeTruthy();
    expect(bid.player.clubCode).toBeTruthy();
    expect(bid.reason).toBeTruthy();
    expect(bid.confidence).toBeGreaterThan(0);
    expect(bid.confidence).toBeLessThanOrEqual(1);
  });
});
