/**
 * Proxy + enrichment routes for Sleeper data.
 *
 * The frontend never hits Sleeper directly. Going through the server gives
 * us: (1) shared player cache, (2) uniform error shape, (3) the ability to
 * pre-join rosters with player metadata so the client doesn't ship 10MB of
 * JSON on first paint.
 */
import { Router } from 'express';
import {
  getUser,
  getUserLeagues,
  getLeague,
  getLeagueRosters,
  getLeagueUsers
} from '../services/sleeper.js';
import { getPlayers, projectPlayer } from '../services/players.js';

const router = Router();

const DEFAULT_SEASON = process.env.SLEEPER_SEASON || '2025';

router.get('/user/:username', async (req, res, next) => {
  try {
    const user = await getUser(req.params.username);
    if (!user) {
      return res.status(404).json({ error: `No Sleeper user named "${req.params.username}"` });
    }
    res.json(user);
  } catch (err) {
    next(err);
  }
});

router.get('/user/:userId/leagues', async (req, res, next) => {
  try {
    const season = req.query.season || DEFAULT_SEASON;
    const leagues = await getUserLeagues(req.params.userId, season);
    // Surface a lightweight view plus dynasty heuristic.
    const trimmed = (leagues || []).map((l) => ({
      league_id: l.league_id,
      name: l.name,
      season: l.season,
      total_rosters: l.total_rosters,
      status: l.status,
      roster_positions: l.roster_positions,
      scoring_settings: l.scoring_settings,
      settings: l.settings,
      is_dynasty:
        l.settings?.type === 2 ||
        /dynasty/i.test(l.name || '') ||
        (l.settings?.taxi_slots ?? 0) > 0
    }));
    res.json(trimmed);
  } catch (err) {
    next(err);
  }
});

/**
 * The big one: given a league_id and user_id, return everything the
 * dashboard needs in one shot — league settings, the user's roster,
 * and all players on that roster projected down to the fields we care about.
 */
router.get('/league/:leagueId/dossier', async (req, res, next) => {
  try {
    const { leagueId } = req.params;
    const { user_id: userId } = req.query;
    if (!userId) {
      return res.status(400).json({ error: 'user_id query parameter is required' });
    }

    const [league, rosters, users, players] = await Promise.all([
      getLeague(leagueId),
      getLeagueRosters(leagueId),
      getLeagueUsers(leagueId),
      getPlayers()
    ]);

    const myRoster = rosters.find((r) => r.owner_id === userId);
    if (!myRoster) {
      return res.status(404).json({
        error: "We couldn't find your roster in that league. Are you sure you're the owner?"
      });
    }

    const enrichIds = (ids) =>
      (ids || []).map((id) => projectPlayer(players[id])).filter(Boolean);

    const starterIds = myRoster.starters || [];
    const allPlayerIds = myRoster.players || [];
    const reserveIds = myRoster.reserve || [];
    const taxiIds = myRoster.taxi || [];

    const benchIds = allPlayerIds.filter(
      (id) =>
        !starterIds.includes(id) && !reserveIds.includes(id) && !taxiIds.includes(id)
    );

    const ownerUser = users.find((u) => u.user_id === userId);

    const leagueMeta = {
      league_id: league.league_id,
      name: league.name,
      season: league.season,
      total_rosters: league.total_rosters,
      roster_positions: league.roster_positions,
      scoring_settings: league.scoring_settings,
      settings: league.settings,
      is_superflex: (league.roster_positions || []).includes('SUPER_FLEX'),
      te_premium: (league.scoring_settings?.bonus_rec_te ?? 0) > 0,
      ppr:
        league.scoring_settings?.rec === 1
          ? 'PPR'
          : league.scoring_settings?.rec === 0.5
            ? 'Half-PPR'
            : 'Standard'
    };

    res.json({
      league: leagueMeta,
      owner: ownerUser
        ? {
            user_id: ownerUser.user_id,
            display_name: ownerUser.display_name,
            avatar: ownerUser.avatar
          }
        : null,
      roster: {
        roster_id: myRoster.roster_id,
        starters: enrichIds(starterIds),
        bench: enrichIds(benchIds),
        taxi: enrichIds(taxiIds),
        ir: enrichIds(reserveIds),
        draft_picks: myRoster.metadata?.draft_picks || null,
        settings: myRoster.settings
      }
    });
  } catch (err) {
    next(err);
  }
});

export default router;
