import { pool, query } from './pool.js';

/**
 * Seed script: fetches player data from the official FPL API
 * and populates the players table.
 *
 * Run: npm run db:seed
 *
 * The FPL bootstrap-static endpoint is public and unauthenticated.
 */

const FPL_BOOTSTRAP_URL = 'https://fantasy.premierleague.com/api/bootstrap-static/';

interface FPLElement {
  id: number;
  web_name: string;
  first_name: string;
  second_name: string;
  element_type: number; // 1=GKP, 2=DEF, 3=MID, 4=FWD
  team: number;
  team_code: number;
  now_cost: number;
  total_points: number;
  points_per_game: string;
  minutes: number;
  status: string; // 'a' = available
  news: string;
  chance_of_playing_next_round: number | null;
}

interface FPLTeam {
  id: number;
  short_name: string;
  name: string;
}

const POSITION_MAP: Record<number, string> = {
  1: 'GKP',
  2: 'DEF',
  3: 'MID',
  4: 'FWD',
};

async function seed(): Promise<void> {
  console.log('Fetching FPL data...');
  const response = await fetch(FPL_BOOTSTRAP_URL);
  if (!response.ok) {
    throw new Error(`FPL API returned ${response.status}`);
  }

  const data = await response.json() as {
    elements: FPLElement[];
    teams: FPLTeam[];
  };

  const teamMap = new Map<number, FPLTeam>();
  for (const team of data.teams) {
    teamMap.set(team.id, team);
  }

  console.log(`Seeding ${data.elements.length} players...`);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Truncate and re-seed
    await client.query('TRUNCATE players CASCADE');

    for (const el of data.elements) {
      const team = teamMap.get(el.team);
      if (!team) continue;

      await client.query(
        `INSERT INTO players (
          fpl_id, web_name, first_name, last_name, position,
          club_code, club_name, now_cost, total_points, points_per_game,
          minutes, available, news, chance_of_playing_next_round
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [
          el.id,
          el.web_name,
          el.first_name,
          el.second_name,
          POSITION_MAP[el.element_type],
          team.short_name,
          team.name,
          el.now_cost,
          el.total_points,
          parseFloat(el.points_per_game),
          el.minutes,
          el.status === 'a',
          el.news || null,
          el.chance_of_playing_next_round,
        ],
      );
    }

    await client.query('COMMIT');
    console.log(`Seeded ${data.elements.length} players.`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
