export interface MockPlayer {
  id: number;
  fplId: number;
  webName: string;
  firstName: string;
  lastName: string;
  position: 'GKP' | 'DEF' | 'MID' | 'FWD';
  clubCode: string;
  clubName: string;
  nowCost: number;
  totalPoints: number;
  pointsPerGame: number;
  minutes: number;
  available: boolean;
  news: string | null;
  chanceOfPlayingNextRound: number | null;
}

// Realistic PL player data for demo
export const MOCK_PLAYERS: MockPlayer[] = [
  // GKP
  { id: 1, fplId: 1, webName: 'Alisson', firstName: 'Alisson', lastName: 'Becker', position: 'GKP', clubCode: 'LIV', clubName: 'Liverpool', nowCost: 55, totalPoints: 126, pointsPerGame: 5.3, minutes: 2070, available: true, news: null, chanceOfPlayingNextRound: null },
  { id: 2, fplId: 2, webName: 'Ederson', firstName: 'Ederson', lastName: 'Moraes', position: 'GKP', clubCode: 'MCI', clubName: 'Man City', nowCost: 55, totalPoints: 118, pointsPerGame: 4.9, minutes: 2160, available: true, news: null, chanceOfPlayingNextRound: null },
  { id: 3, fplId: 3, webName: 'Raya', firstName: 'David', lastName: 'Raya', position: 'GKP', clubCode: 'ARS', clubName: 'Arsenal', nowCost: 53, totalPoints: 132, pointsPerGame: 5.5, minutes: 2160, available: true, news: null, chanceOfPlayingNextRound: null },
  { id: 4, fplId: 4, webName: 'Onana', firstName: 'Andre', lastName: 'Onana', position: 'GKP', clubCode: 'MUN', clubName: 'Man Utd', nowCost: 50, totalPoints: 98, pointsPerGame: 4.1, minutes: 2160, available: true, news: null, chanceOfPlayingNextRound: null },
  { id: 5, fplId: 5, webName: 'Martinez', firstName: 'Emiliano', lastName: 'Martinez', position: 'GKP', clubCode: 'AVL', clubName: 'Aston Villa', nowCost: 50, totalPoints: 105, pointsPerGame: 4.4, minutes: 2070, available: true, news: null, chanceOfPlayingNextRound: null },
  { id: 6, fplId: 6, webName: 'Sanchez', firstName: 'Robert', lastName: 'Sanchez', position: 'GKP', clubCode: 'CHE', clubName: 'Chelsea', nowCost: 45, totalPoints: 82, pointsPerGame: 3.7, minutes: 1980, available: true, news: null, chanceOfPlayingNextRound: null },

  // DEF
  { id: 10, fplId: 10, webName: 'Alexander-Arnold', firstName: 'Trent', lastName: 'Alexander-Arnold', position: 'DEF', clubCode: 'LIV', clubName: 'Liverpool', nowCost: 72, totalPoints: 151, pointsPerGame: 6.3, minutes: 1980, available: true, news: null, chanceOfPlayingNextRound: null },
  { id: 11, fplId: 11, webName: 'Saliba', firstName: 'William', lastName: 'Saliba', position: 'DEF', clubCode: 'ARS', clubName: 'Arsenal', nowCost: 60, totalPoints: 138, pointsPerGame: 5.8, minutes: 2160, available: true, news: null, chanceOfPlayingNextRound: null },
  { id: 12, fplId: 12, webName: 'Gabriel', firstName: 'Gabriel', lastName: 'Magalhaes', position: 'DEF', clubCode: 'ARS', clubName: 'Arsenal', nowCost: 58, totalPoints: 142, pointsPerGame: 5.9, minutes: 2160, available: true, news: null, chanceOfPlayingNextRound: null },
  { id: 13, fplId: 13, webName: 'Van Dijk', firstName: 'Virgil', lastName: 'van Dijk', position: 'DEF', clubCode: 'LIV', clubName: 'Liverpool', nowCost: 63, totalPoints: 130, pointsPerGame: 5.4, minutes: 2160, available: true, news: null, chanceOfPlayingNextRound: null },
  { id: 14, fplId: 14, webName: 'Robertson', firstName: 'Andrew', lastName: 'Robertson', position: 'DEF', clubCode: 'LIV', clubName: 'Liverpool', nowCost: 60, totalPoints: 122, pointsPerGame: 5.1, minutes: 2070, available: true, news: null, chanceOfPlayingNextRound: null },
  { id: 15, fplId: 15, webName: 'Gvardiol', firstName: 'Josko', lastName: 'Gvardiol', position: 'DEF', clubCode: 'MCI', clubName: 'Man City', nowCost: 56, totalPoints: 109, pointsPerGame: 4.5, minutes: 2070, available: true, news: null, chanceOfPlayingNextRound: null },
  { id: 16, fplId: 16, webName: 'Pedro Porro', firstName: 'Pedro', lastName: 'Porro', position: 'DEF', clubCode: 'TOT', clubName: 'Spurs', nowCost: 55, totalPoints: 112, pointsPerGame: 4.7, minutes: 2070, available: true, news: null, chanceOfPlayingNextRound: null },
  { id: 17, fplId: 17, webName: 'Cucurella', firstName: 'Marc', lastName: 'Cucurella', position: 'DEF', clubCode: 'CHE', clubName: 'Chelsea', nowCost: 52, totalPoints: 97, pointsPerGame: 4.0, minutes: 2070, available: true, news: null, chanceOfPlayingNextRound: null },
  { id: 18, fplId: 18, webName: 'Estupinan', firstName: 'Pervis', lastName: 'Estupinan', position: 'DEF', clubCode: 'BHA', clubName: 'Brighton', nowCost: 50, totalPoints: 88, pointsPerGame: 4.0, minutes: 1890, available: true, news: null, chanceOfPlayingNextRound: null },
  { id: 19, fplId: 19, webName: 'Timber', firstName: 'Jurrien', lastName: 'Timber', position: 'DEF', clubCode: 'ARS', clubName: 'Arsenal', nowCost: 54, totalPoints: 101, pointsPerGame: 4.2, minutes: 2070, available: true, news: null, chanceOfPlayingNextRound: null },
  { id: 20, fplId: 20, webName: 'Walker', firstName: 'Kyle', lastName: 'Walker', position: 'DEF', clubCode: 'MCI', clubName: 'Man City', nowCost: 52, totalPoints: 86, pointsPerGame: 3.6, minutes: 1980, available: true, news: null, chanceOfPlayingNextRound: null },
  { id: 21, fplId: 21, webName: 'Mazraoui', firstName: 'Noussair', lastName: 'Mazraoui', position: 'DEF', clubCode: 'MUN', clubName: 'Man Utd', nowCost: 45, totalPoints: 79, pointsPerGame: 3.5, minutes: 1890, available: true, news: null, chanceOfPlayingNextRound: null },

  // MID
  { id: 30, fplId: 30, webName: 'Salah', firstName: 'Mohamed', lastName: 'Salah', position: 'MID', clubCode: 'LIV', clubName: 'Liverpool', nowCost: 130, totalPoints: 201, pointsPerGame: 8.4, minutes: 2070, available: true, news: null, chanceOfPlayingNextRound: null },
  { id: 31, fplId: 31, webName: 'Saka', firstName: 'Bukayo', lastName: 'Saka', position: 'MID', clubCode: 'ARS', clubName: 'Arsenal', nowCost: 100, totalPoints: 168, pointsPerGame: 7.0, minutes: 2070, available: true, news: null, chanceOfPlayingNextRound: null },
  { id: 32, fplId: 32, webName: 'Palmer', firstName: 'Cole', lastName: 'Palmer', position: 'MID', clubCode: 'CHE', clubName: 'Chelsea', nowCost: 105, totalPoints: 176, pointsPerGame: 7.3, minutes: 2160, available: true, news: null, chanceOfPlayingNextRound: null },
  { id: 33, fplId: 33, webName: 'Foden', firstName: 'Phil', lastName: 'Foden', position: 'MID', clubCode: 'MCI', clubName: 'Man City', nowCost: 92, totalPoints: 140, pointsPerGame: 6.4, minutes: 1890, available: true, news: 'Knock - 75% chance of playing', chanceOfPlayingNextRound: 75 },
  { id: 34, fplId: 34, webName: 'Son', firstName: 'Heung-Min', lastName: 'Son', position: 'MID', clubCode: 'TOT', clubName: 'Spurs', nowCost: 95, totalPoints: 148, pointsPerGame: 6.2, minutes: 2070, available: true, news: null, chanceOfPlayingNextRound: null },
  { id: 35, fplId: 35, webName: 'Odegaard', firstName: 'Martin', lastName: 'Odegaard', position: 'MID', clubCode: 'ARS', clubName: 'Arsenal', nowCost: 85, totalPoints: 125, pointsPerGame: 5.7, minutes: 1890, available: false, news: 'Ankle - Expected back GW28', chanceOfPlayingNextRound: 0 },
  { id: 36, fplId: 36, webName: 'Bruno Fernandes', firstName: 'Bruno', lastName: 'Fernandes', position: 'MID', clubCode: 'MUN', clubName: 'Man Utd', nowCost: 83, totalPoints: 118, pointsPerGame: 4.9, minutes: 2160, available: true, news: null, chanceOfPlayingNextRound: null },
  { id: 37, fplId: 37, webName: 'De Bruyne', firstName: 'Kevin', lastName: 'De Bruyne', position: 'MID', clubCode: 'MCI', clubName: 'Man City', nowCost: 96, totalPoints: 95, pointsPerGame: 6.8, minutes: 1170, available: true, news: 'Returning from injury', chanceOfPlayingNextRound: 50 },
  { id: 38, fplId: 38, webName: 'Diaz', firstName: 'Luis', lastName: 'Diaz', position: 'MID', clubCode: 'LIV', clubName: 'Liverpool', nowCost: 78, totalPoints: 121, pointsPerGame: 5.0, minutes: 2070, available: true, news: null, chanceOfPlayingNextRound: null },
  { id: 39, fplId: 39, webName: 'Gordon', firstName: 'Anthony', lastName: 'Gordon', position: 'MID', clubCode: 'NEW', clubName: 'Newcastle', nowCost: 73, totalPoints: 115, pointsPerGame: 4.8, minutes: 2070, available: true, news: null, chanceOfPlayingNextRound: null },
  { id: 40, fplId: 40, webName: 'Neto', firstName: 'Pedro', lastName: 'Neto', position: 'MID', clubCode: 'CHE', clubName: 'Chelsea', nowCost: 66, totalPoints: 92, pointsPerGame: 4.2, minutes: 1890, available: true, news: null, chanceOfPlayingNextRound: null },
  { id: 41, fplId: 41, webName: 'Mbeumo', firstName: 'Bryan', lastName: 'Mbeumo', position: 'MID', clubCode: 'BRE', clubName: 'Brentford', nowCost: 72, totalPoints: 131, pointsPerGame: 5.5, minutes: 2070, available: true, news: null, chanceOfPlayingNextRound: null },
  { id: 42, fplId: 42, webName: 'Rogers', firstName: 'Morgan', lastName: 'Rogers', position: 'MID', clubCode: 'AVL', clubName: 'Aston Villa', nowCost: 58, totalPoints: 104, pointsPerGame: 4.3, minutes: 2070, available: true, news: null, chanceOfPlayingNextRound: null },
  { id: 43, fplId: 43, webName: 'Jota', firstName: 'Diogo', lastName: 'Jota', position: 'MID', clubCode: 'LIV', clubName: 'Liverpool', nowCost: 76, totalPoints: 88, pointsPerGame: 5.5, minutes: 1350, available: true, news: null, chanceOfPlayingNextRound: null },

  // FWD
  { id: 50, fplId: 50, webName: 'Haaland', firstName: 'Erling', lastName: 'Haaland', position: 'FWD', clubCode: 'MCI', clubName: 'Man City', nowCost: 148, totalPoints: 186, pointsPerGame: 7.8, minutes: 2070, available: true, news: null, chanceOfPlayingNextRound: null },
  { id: 51, fplId: 51, webName: 'Isak', firstName: 'Alexander', lastName: 'Isak', position: 'FWD', clubCode: 'NEW', clubName: 'Newcastle', nowCost: 88, totalPoints: 152, pointsPerGame: 6.3, minutes: 2070, available: true, news: null, chanceOfPlayingNextRound: null },
  { id: 52, fplId: 52, webName: 'Watkins', firstName: 'Ollie', lastName: 'Watkins', position: 'FWD', clubCode: 'AVL', clubName: 'Aston Villa', nowCost: 82, totalPoints: 130, pointsPerGame: 5.4, minutes: 2070, available: true, news: null, chanceOfPlayingNextRound: null },
  { id: 53, fplId: 53, webName: 'Havertz', firstName: 'Kai', lastName: 'Havertz', position: 'FWD', clubCode: 'ARS', clubName: 'Arsenal', nowCost: 78, totalPoints: 124, pointsPerGame: 5.2, minutes: 2070, available: true, news: null, chanceOfPlayingNextRound: null },
  { id: 54, fplId: 54, webName: 'Jackson', firstName: 'Nicolas', lastName: 'Jackson', position: 'FWD', clubCode: 'CHE', clubName: 'Chelsea', nowCost: 76, totalPoints: 118, pointsPerGame: 4.9, minutes: 2070, available: true, news: null, chanceOfPlayingNextRound: null },
  { id: 55, fplId: 55, webName: 'Solanke', firstName: 'Dominic', lastName: 'Solanke', position: 'FWD', clubCode: 'TOT', clubName: 'Spurs', nowCost: 72, totalPoints: 101, pointsPerGame: 4.2, minutes: 2070, available: true, news: null, chanceOfPlayingNextRound: null },
  { id: 56, fplId: 56, webName: 'Cunha', firstName: 'Matheus', lastName: 'Cunha', position: 'FWD', clubCode: 'WOL', clubName: 'Wolves', nowCost: 70, totalPoints: 112, pointsPerGame: 4.7, minutes: 2070, available: true, news: null, chanceOfPlayingNextRound: null },
  { id: 57, fplId: 57, webName: 'Joao Pedro', firstName: 'Joao', lastName: 'Pedro', position: 'FWD', clubCode: 'BHA', clubName: 'Brighton', nowCost: 57, totalPoints: 89, pointsPerGame: 3.7, minutes: 2070, available: true, news: null, chanceOfPlayingNextRound: null },
];

export const CLUBS = [
  'ARS', 'AVL', 'BHA', 'BRE', 'CHE', 'CRY', 'EVE', 'FUL',
  'IPS', 'LEI', 'LIV', 'MCI', 'MUN', 'NEW', 'NFO', 'SOU',
  'TOT', 'WHU', 'WOL', 'BOU',
] as const;
