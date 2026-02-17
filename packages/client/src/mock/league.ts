import { MOCK_PLAYERS, type MockPlayer } from './players.js';

export interface MockMember {
  id: string;
  teamName: string;
  username: string;
  draftSeed: number;
  faabRemaining: number;
  roster: MockPlayer[];
}

export interface MockDraftPick {
  overallPick: number;
  round: number;
  memberId: string;
  teamName: string;
  player: MockPlayer;
  autoPick: boolean;
}

// 8-team league
const TEAM_NAMES = [
  'Invincibles FC', 'Gegenpressing XI', 'Set Piece Merchants',
  'Park the Bus FC', 'VAR Victims', 'xG Believers',
  'Counter Attack Utd', 'False Nine FC',
];
const USERNAMES = [
  'alexfpl', 'sarah_tactics', 'draftking99', 'pk_taker',
  'varchester', 'xgmaster', 'pace_abuser', 'tiki_taka_tom',
];

export const MOCK_MEMBERS: MockMember[] = TEAM_NAMES.map((name, i) => ({
  id: `member-${i + 1}`,
  teamName: name,
  username: USERNAMES[i],
  draftSeed: i + 1,
  faabRemaining: 100 - Math.floor(Math.random() * 30),
  roster: [],
}));

// Generate a mock draft (first 48 picks of a snake — 8 teams, ~6 rounds)
export function generateMockDraft(): {
  picks: MockDraftPick[];
  rosters: Map<string, MockPlayer[]>;
  availablePlayers: MockPlayer[];
} {
  const picks: MockDraftPick[] = [];
  const rosters = new Map<string, MockPlayer[]>();
  const drafted = new Set<number>();

  for (const m of MOCK_MEMBERS) {
    rosters.set(m.id, []);
  }

  // Sort players by points for naive draft sim
  const sortedPlayers = [...MOCK_PLAYERS].sort((a, b) => b.totalPoints - a.totalPoints);
  let playerIdx = 0;

  const totalPicks = 48; // 6 rounds x 8 teams
  for (let pick = 1; pick <= totalPicks; pick++) {
    const round = Math.ceil(pick / 8);
    const isEven = round % 2 === 0;
    const pickInRound = ((pick - 1) % 8);
    const memberIdx = isEven ? 7 - pickInRound : pickInRound;
    const member = MOCK_MEMBERS[memberIdx];

    // Find next available player
    while (playerIdx < sortedPlayers.length && drafted.has(sortedPlayers[playerIdx].id)) {
      playerIdx++;
    }
    if (playerIdx >= sortedPlayers.length) break;

    const player = sortedPlayers[playerIdx];
    drafted.add(player.id);
    playerIdx++;

    picks.push({
      overallPick: pick,
      round,
      memberId: member.id,
      teamName: member.teamName,
      player,
      autoPick: Math.random() < 0.08, // ~8% auto-picks
    });

    rosters.get(member.id)!.push(player);
  }

  const availablePlayers = MOCK_PLAYERS.filter((p) => !drafted.has(p.id));
  return { picks, rosters, availablePlayers };
}

// Mock gameweek scores
export interface MockGameweekScore {
  memberId: string;
  teamName: string;
  gameweek: number;
  points: number;
  totalPoints: number;
  rank: number;
}

export function generateMockStandings(
  members: MockMember[],
  gameweeks: number = 24,
): MockGameweekScore[][] {
  const allScores: MockGameweekScore[][] = [];
  const cumulative = new Map<string, number>();
  for (const m of members) cumulative.set(m.id, 0);

  for (let gw = 1; gw <= gameweeks; gw++) {
    const gwScores: MockGameweekScore[] = members.map((m) => {
      const pts = 30 + Math.floor(Math.random() * 50);
      const total = (cumulative.get(m.id) ?? 0) + pts;
      cumulative.set(m.id, total);
      return { memberId: m.id, teamName: m.teamName, gameweek: gw, points: pts, totalPoints: total, rank: 0 };
    });
    gwScores.sort((a, b) => b.totalPoints - a.totalPoints);
    gwScores.forEach((s, i) => s.rank = i + 1);
    allScores.push(gwScores);
  }

  return allScores;
}

// Mock H2H fixture
export interface MockH2HFixture {
  homeTeam: string;
  awayTeam: string;
  homePoints: number;
  awayPoints: number;
  winner: 'home' | 'away' | 'draw';
}

export function generateMockH2HFixtures(members: MockMember[]): MockH2HFixture[] {
  const fixtures: MockH2HFixture[] = [];
  for (let i = 0; i < members.length; i += 2) {
    if (i + 1 >= members.length) break;
    const hp = 30 + Math.floor(Math.random() * 50);
    const ap = 30 + Math.floor(Math.random() * 50);
    fixtures.push({
      homeTeam: members[i].teamName,
      awayTeam: members[i + 1].teamName,
      homePoints: hp,
      awayPoints: ap,
      winner: hp > ap ? 'home' : ap > hp ? 'away' : 'draw',
    });
  }
  return fixtures;
}
