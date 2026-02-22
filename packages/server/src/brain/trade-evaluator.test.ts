import { describe, it, expect } from 'vitest';
import { evaluateTrade } from './trade-evaluator.js';
import { HeuristicEngine } from './projection/heuristic.js';
import type { ProjectionContext, FplPlayer, FplClub, Fixture, BrainRoster } from './types.js';

// ── Test helpers ──────────────────────────────────────────────

function makePlayer(id: number, name: string, pos: 'GKP' | 'DEF' | 'MID' | 'FWD', teamId: number, clubCode: string, overrides: Partial<FplPlayer> = {}): FplPlayer {
  return {
    id,
    webName: name,
    firstName: name,
    lastName: name,
    position: pos,
    teamId,
    clubCode,
    clubName: clubCode,
    nowCost: 80,
    totalPoints: 80,
    ppg: 4.5,
    form: 5.0,
    ictIndex: 100,
    minutes: 1800,
    status: 'a',
    news: null,
    chanceOfPlayingThisRound: null,
    chanceOfPlayingNextRound: null,
    epThis: 4.0,
    epNext: 4.0,
    ...overrides,
  };
}

function makeContext(players: FplPlayer[]): ProjectionContext {
  const playerMap = new Map<number, FplPlayer>();
  for (const p of players) playerMap.set(p.id, p);

  const fixtures: Fixture[] = [];
  const teamIds = [...new Set(players.map((p) => p.teamId))];
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

  return {
    currentGameweek: 20,
    totalGameweeks: 38,
    players: playerMap,
    clubs: new Map<number, FplClub>(),
    fixtures,
    recentStats: new Map(),
  };
}

function makeRoster(memberId: string, teamName: string, playerIds: number[]): BrainRoster {
  return { memberId, teamName, playerIds, faabRemaining: 50 };
}

// ── Tests ────────────────────────────────────────────────────

describe('evaluateTrade', () => {
  const engine = new HeuristicEngine();

  // Team A: 2 GKP, 5 DEF, 5 MID, 3 FWD = 15 players
  // Max 3 per club: ARS=3, CRY=3, NEW=2, AVL=2, MCI=2, BOU=1, WHU=1, BRE=1
  const teamAPlayers = [
    makePlayer(1, 'Raya', 'GKP', 1, 'ARS'),
    makePlayer(2, 'Henderson', 'GKP', 7, 'CRY'),
    makePlayer(3, 'Saliba', 'DEF', 1, 'ARS'),
    makePlayer(4, 'Gabriel', 'DEF', 3, 'BOU', { ppg: 3.0, form: 3.0 }),
    makePlayer(5, 'Trippier', 'DEF', 11, 'NEW'),
    makePlayer(6, 'Guehi', 'DEF', 7, 'CRY'),
    makePlayer(7, 'Cash', 'DEF', 2, 'AVL'),
    makePlayer(8, 'Saka', 'MID', 1, 'ARS', { ppg: 8.0, form: 9.0, totalPoints: 170 }),
    makePlayer(9, 'Foden', 'MID', 10, 'MCI'),
    makePlayer(10, 'Bowen', 'MID', 17, 'WHU'),
    makePlayer(11, 'Gordon', 'MID', 11, 'NEW'),
    makePlayer(12, 'Eze', 'MID', 7, 'CRY'),
    makePlayer(13, 'Haaland', 'FWD', 10, 'MCI', { ppg: 7.0, form: 7.0, totalPoints: 140 }),
    makePlayer(14, 'Watkins', 'FWD', 2, 'AVL'),
    makePlayer(15, 'Toney', 'FWD', 4, 'BRE'),
  ];

  // Team B: 2 GKP, 5 DEF, 5 MID, 3 FWD = 15 players
  // Max 3 per club: LIV=3, CHE=3, MCI=1, BHA=1, CRY=1, AVL=1, BRE=1, WHU=1, NFO=1, NEW=1, WOL=1
  const teamBPlayers = [
    makePlayer(51, 'Alisson', 'GKP', 14, 'LIV'),
    makePlayer(52, 'Sanchez', 'GKP', 6, 'CHE'),
    makePlayer(53, 'VVD', 'DEF', 14, 'LIV'),
    makePlayer(54, 'Gvardiol', 'DEF', 10, 'MCI'),
    makePlayer(55, 'Estupinan', 'DEF', 5, 'BHA'),
    makePlayer(56, 'Mitchell', 'DEF', 7, 'CRY'),
    makePlayer(57, 'Konsa', 'DEF', 2, 'AVL'),
    makePlayer(58, 'Salah', 'MID', 14, 'LIV', { ppg: 8.5, form: 9.5, totalPoints: 200 }),
    makePlayer(59, 'Palmer', 'MID', 6, 'CHE', { ppg: 7.5, form: 7.0, totalPoints: 155 }),
    makePlayer(60, 'Mbeumo', 'MID', 4, 'BRE'),
    makePlayer(61, 'Kudus', 'MID', 17, 'WHU'),
    makePlayer(62, 'Elanga', 'MID', 12, 'NFO'),
    makePlayer(63, 'Isak', 'FWD', 11, 'NEW', { ppg: 6.5, form: 7.0, totalPoints: 130 }),
    makePlayer(64, 'Jackson', 'FWD', 6, 'CHE'),
    makePlayer(65, 'Cunha', 'FWD', 18, 'WOL'),
  ];

  const allPlayers = [...teamAPlayers, ...teamBPlayers];
  const ctx = makeContext(allPlayers);
  const rosterA = makeRoster('a', 'Arsenal Invincibles', teamAPlayers.map((p) => p.id));
  const rosterB = makeRoster('b', 'Liverpool FC', teamBPlayers.map((p) => p.id));

  it('evaluates a fair 1-for-1 same-position trade', () => {
    // Saka (MID, ARS) for Palmer (MID, CHE) — same position, different clubs
    const result = evaluateTrade(
      {
        rosterA,
        rosterB,
        sendPlayerIds: [8],      // Saka (MID, ARS, 8.0 PPG)
        receivePlayerIds: [59],   // Palmer (MID, CHE, 7.5 PPG)
      },
      engine,
      ctx,
    );

    expect(result.valid).toBe(true);
    expect(result.violations).toHaveLength(0);
    expect(result.sideA.players).toHaveLength(1);
    expect(result.sideB.players).toHaveLength(1);
    expect(result.sideA.players[0].name).toBe('Saka');
    expect(result.sideB.players[0].name).toBe('Palmer');
    expect(result.summary).toBeTruthy();
  });

  it('detects uneven trades as squad_size violation', () => {
    const result = evaluateTrade(
      {
        rosterA,
        rosterB,
        sendPlayerIds: [8, 13],   // 2 players
        receivePlayerIds: [59],    // 1 player
      },
      engine,
      ctx,
    );

    expect(result.valid).toBe(false);
    expect(result.violations.some((v) => v.type === 'squad_size')).toBe(true);
  });

  it('validates clean same-position swap across clubs', () => {
    // A sends Trippier (DEF, NEW) for B's Estupinan (DEF, BHA)
    const result = evaluateTrade(
      {
        rosterA,
        rosterB,
        sendPlayerIds: [5],     // Trippier (DEF, NEW)
        receivePlayerIds: [55],  // Estupinan (DEF, BHA)
      },
      engine,
      ctx,
    );

    expect(result.valid).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it('computes fairness score between -1 and 1', () => {
    const result = evaluateTrade(
      {
        rosterA,
        rosterB,
        sendPlayerIds: [8],      // Saka
        receivePlayerIds: [59],   // Palmer
      },
      engine,
      ctx,
    );

    expect(result.fairnessScore).toBeGreaterThanOrEqual(-1);
    expect(result.fairnessScore).toBeLessThanOrEqual(1);
  });

  it('returns a valid verdict string', () => {
    const result = evaluateTrade(
      {
        rosterA,
        rosterB,
        sendPlayerIds: [9],      // Foden (MID)
        receivePlayerIds: [62],   // Elanga (MID)
      },
      engine,
      ctx,
    );

    const validVerdicts = [
      'fair',
      'slightly_favors_a', 'favors_a', 'heavily_favors_a',
      'slightly_favors_b', 'favors_b', 'heavily_favors_b',
    ];
    expect(validVerdicts).toContain(result.verdict);
  });

  it('includes roster impact analysis', () => {
    // FWD for FWD — same position
    const result = evaluateTrade(
      {
        rosterA,
        rosterB,
        sendPlayerIds: [13],     // Haaland (FWD)
        receivePlayerIds: [63],   // Isak (FWD)
      },
      engine,
      ctx,
    );

    expect(result.sideA.rosterImpact).toBeTruthy();
    expect(result.sideB.rosterImpact).toBeTruthy();
  });

  it('includes fixture run data for traded players', () => {
    // MID for MID
    const result = evaluateTrade(
      {
        rosterA,
        rosterB,
        sendPlayerIds: [8],      // Saka (MID)
        receivePlayerIds: [58],   // Salah (MID)
      },
      engine,
      ctx,
    );

    result.sideA.players.forEach((p) => {
      expect(p.fixtureRun).toBeGreaterThan(0);
    });
    result.sideB.players.forEach((p) => {
      expect(p.fixtureRun).toBeGreaterThan(0);
    });
  });

  it('identifies lopsided trades', () => {
    // A sends Eze (MID, 4.5 PPG) for Salah (MID, 8.5 PPG) — clearly lopsided
    const result = evaluateTrade(
      {
        rosterA,
        rosterB,
        sendPlayerIds: [12],     // Eze (MID, CRY, 4.5 PPG)
        receivePlayerIds: [58],   // Salah (MID, LIV, 8.5 PPG)
      },
      engine,
      ctx,
    );

    // Should favor one side
    expect(Math.abs(result.fairnessScore)).toBeGreaterThan(0.05);
  });
});
