/**
 * Thin wrapper around the public Sleeper API.
 * All endpoints are unauthenticated — we just proxy through our backend
 * so we can cache the heavy responses (players list) and keep CORS sane.
 */
const BASE = 'https://api.sleeper.app/v1';

async function sleeperFetch(path) {
  const res = await fetch(`${BASE}${path}`);
  if (res.status === 404) {
    const err = new Error(`Sleeper resource not found: ${path}`);
    err.status = 404;
    err.code = 'SLEEPER_NOT_FOUND';
    throw err;
  }
  if (!res.ok) {
    const err = new Error(`Sleeper API error (${res.status}): ${path}`);
    err.status = 502;
    err.code = 'SLEEPER_UPSTREAM';
    throw err;
  }
  return res.json();
}

export function getUser(username) {
  return sleeperFetch(`/user/${encodeURIComponent(username)}`);
}

export function getUserLeagues(userId, season) {
  return sleeperFetch(`/user/${userId}/leagues/nfl/${season}`);
}

export function getLeague(leagueId) {
  return sleeperFetch(`/league/${leagueId}`);
}

export function getLeagueRosters(leagueId) {
  return sleeperFetch(`/league/${leagueId}/rosters`);
}

export function getLeagueUsers(leagueId) {
  return sleeperFetch(`/league/${leagueId}/users`);
}

export function getAllPlayers() {
  return sleeperFetch(`/players/nfl`);
}

export function getTradedPicks(leagueId) {
  return sleeperFetch(`/league/${leagueId}/traded_picks`);
}
