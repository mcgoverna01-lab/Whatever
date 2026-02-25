import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sleeper } from '../brain/sleeper-client.js';
import { fpl } from '../brain/index.js';
import { query } from '../db/pool.js';

/**
 * Sleeper integration routes.
 *
 * Sleeper is the league management platform — it holds rosters, standings,
 * FAAB balances and transaction history for the FPL draft league.
 *
 * These routes let you:
 *   1. Preview a Sleeper league before importing
 *   2. Sync Sleeper roster/standings data into the Pitch Draft DB
 *   3. Import draft picks from a completed Sleeper draft
 *
 * GET  /api/sleeper/league/:sleeperLeagueId          → Preview league info
 * POST /api/sleeper/sync/:leagueId/:sleeperLeagueId  → Sync rosters into local DB
 * GET  /api/sleeper/transactions/:sleeperLeagueId    → Recent transactions
 * POST /api/sleeper/import-draft/:leagueId/:draftId  → Import Sleeper draft picks
 */
export async function registerSleeperRoutes(app: FastifyInstance): Promise<void> {

  // ── Preview Sleeper league ──────────────────────────────────

  app.get('/api/sleeper/league/:sleeperLeagueId', async (req, reply) => {
    const { sleeperLeagueId } = z.object({
      sleeperLeagueId: z.string().min(1),
    }).parse(req.params);

    const [summary, rosters, users] = await Promise.all([
      sleeper.getLeagueSummary(sleeperLeagueId),
      sleeper.getRosters(sleeperLeagueId),
      sleeper.getUsers(sleeperLeagueId),
    ]);

    const userMap = new Map(users.map((u) => [u.user_id, u]));

    const teams = rosters.map((r) => {
      const user = userMap.get(r.owner_id);
      return {
        rosterId: r.roster_id,
        displayName: user?.display_name ?? `Team ${r.roster_id}`,
        teamName: user?.metadata?.team_name ?? user?.display_name ?? `Team ${r.roster_id}`,
        playerCount: (r.players?.length ?? 0) + (r.reserve?.length ?? 0),
        wins: r.settings?.wins ?? 0,
        losses: r.settings?.losses ?? 0,
        faabUsed: r.settings?.waiver_budget_used ?? 0,
        waiverPosition: r.settings?.waiver_position ?? 0,
      };
    });

    return reply.send({ league: summary, teams });
  });

  // ── Sync Sleeper → local DB ──────────────────────────────────

  app.post('/api/sleeper/sync/:leagueId/:sleeperLeagueId', async (req, reply) => {
    const params = z.object({
      leagueId: z.string().uuid(),
      sleeperLeagueId: z.string().min(1),
    }).parse(req.params);

    // Fetch FPL player map for name-based ID mapping
    const [fplCtx, leagueSummary] = await Promise.all([
      fpl.buildContext(),
      sleeper.getLeagueSummary(params.sleeperLeagueId),
    ]);

    const rosterSummaries = await sleeper.getRosterSummaries(
      params.sleeperLeagueId,
      fplCtx.players,
      leagueSummary.faabBudget,
    );

    let synced = 0;
    let errors = 0;
    const syncLog: string[] = [];

    for (const rs of rosterSummaries) {
      try {
        // Try to find an existing member by display_name match
        const existing = await query(
          `SELECT id FROM league_members
           WHERE league_id = $1 AND (team_name = $2 OR sleeper_user_id = $3)
           LIMIT 1`,
          [params.leagueId, rs.teamName, rs.ownerId],
        );

        if (existing.rows.length > 0) {
          const memberId = existing.rows[0].id;

          // Update FAAB balance and standings
          await query(
            `UPDATE league_members
             SET faab_remaining = $2, sleeper_user_id = $3, sleeper_roster_id = $4
             WHERE id = $1`,
            [memberId, rs.faabRemaining, rs.ownerId, rs.rosterId],
          );

          // Sync roster slots (FPL player IDs we've mapped)
          if (rs.fplPlayerIds.length > 0) {
            // Clear existing roster and rebuild from Sleeper data
            await query(`DELETE FROM roster_slots WHERE member_id = $1`, [memberId]);
            for (const playerId of rs.fplPlayerIds) {
              await query(
                `INSERT INTO roster_slots (member_id, player_id) VALUES ($1, $2)
                 ON CONFLICT DO NOTHING`,
                [memberId, playerId],
              );
            }
          }

          syncLog.push(
            `✓ ${rs.teamName}: FAAB £${rs.faabRemaining} remaining, ` +
            `${rs.fplPlayerIds.length}/${rs.playerIds.length} players mapped`,
          );
        } else {
          syncLog.push(`⚠ ${rs.teamName}: no matching league member found — add them first`);
        }
        synced++;
      } catch (err) {
        errors++;
        syncLog.push(`✗ ${rs.teamName}: ${(err as Error).message}`);
      }
    }

    return reply.send({
      synced,
      errors,
      waiverType: leagueSummary.waiverType,
      faabBudget: leagueSummary.faabBudget,
      log: syncLog,
    });
  });

  // ── Recent transactions ──────────────────────────────────────

  app.get('/api/sleeper/transactions/:sleeperLeagueId', async (req, reply) => {
    const { sleeperLeagueId } = z.object({
      sleeperLeagueId: z.string().min(1),
    }).parse(req.params);

    const qs = z.object({
      week: z.coerce.number().int().min(1).max(38).default(1),
      weeks: z.coerce.number().int().min(1).max(10).default(3),
    }).parse(req.query);

    const txns = await sleeper.getRecentTransactions(
      sleeperLeagueId,
      qs.week,
      qs.weeks,
    );

    const summary = txns.map((t) => ({
      id: t.transaction_id,
      type: t.type,
      status: t.status,
      date: new Date(t.created).toISOString(),
      adds: Object.keys(t.adds ?? {}).length,
      drops: Object.keys(t.drops ?? {}).length,
      faabBid: t.settings?.waiver_bid ?? null,
    }));

    return reply.send({ count: summary.length, transactions: summary });
  });

  // ── Import Sleeper draft picks ───────────────────────────────

  app.post('/api/sleeper/import-draft/:leagueId/:sleepDraftId', async (req, reply) => {
    const params = z.object({
      leagueId: z.string().uuid(),
      sleepDraftId: z.string().min(1),
    }).parse(req.params);

    const [fplCtx, draft, picks] = await Promise.all([
      fpl.buildContext(),
      sleeper.getDraft(params.sleepDraftId),
      sleeper.getDraftPicks(params.sleepDraftId),
    ]);

    if (draft.status !== 'complete') {
      return reply.code(400).send({ error: 'Draft is not yet complete', status: draft.status });
    }

    // Find the local draft
    const draftRow = await query(
      `SELECT d.id FROM drafts d WHERE d.league_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [params.leagueId],
    );

    if (!draftRow.rows.length) {
      return reply.code(404).send({ error: 'No draft found for this league' });
    }

    const localDraftId = draftRow.rows[0].id;
    let imported = 0;
    let skipped = 0;

    for (const pick of picks) {
      // Find FPL player by name
      const firstName = pick.metadata?.first_name?.toLowerCase() ?? '';
      const lastName = pick.metadata?.last_name?.toLowerCase() ?? '';
      let fplPlayerId: number | null = null;

      for (const [id, p] of fplCtx.players) {
        const fplFull = `${p.firstName} ${p.lastName}`.toLowerCase();
        if (fplFull === `${firstName} ${lastName}` || p.webName.toLowerCase() === lastName) {
          fplPlayerId = id;
          break;
        }
      }

      if (fplPlayerId === null) {
        skipped++;
        continue;
      }

      // Find the league member by roster_id
      const member = await query(
        `SELECT id FROM league_members
         WHERE league_id = $1 AND sleeper_roster_id = $2
         LIMIT 1`,
        [params.leagueId, pick.roster_id],
      );

      if (!member.rows.length) {
        skipped++;
        continue;
      }

      // Insert draft pick
      await query(
        `INSERT INTO draft_picks (draft_id, member_id, player_id, round, pick_number, overall_pick)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (draft_id, overall_pick) DO UPDATE
           SET member_id = EXCLUDED.member_id,
               player_id = EXCLUDED.player_id`,
        [localDraftId, member.rows[0].id, fplPlayerId, pick.round, pick.draft_slot, pick.pick_no],
      );
      imported++;
    }

    return reply.send({
      draftId: params.sleepDraftId,
      totalPicks: picks.length,
      imported,
      skipped,
      message: `Imported ${imported} picks (${skipped} skipped — player name not matched)`,
    });
  });
}
