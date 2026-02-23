import type pg from 'pg';
import { pool, withAdvisoryLock } from '../db/pool.js';
import { generateSnakeOrder, generateLinearOrder } from './snake-order.js';
import type { DraftPick } from '@pitch-draft/shared';

// ── Types ────────────────────────────────────────────────────────

interface DraftRow {
  id: string;
  league_id: string;
  status: string;
  total_rounds: number;
  current_round: number;
  current_pick: number;
  pick_timer_seconds: number;
  pick_timer_started_at: string | null;
}

interface QueueRow {
  draft_id: string;
  overall_pick: number;
  round: number;
  pick_in_round: number;
  member_id: string;
  player_id: number | null;
  picked_at: string | null;
  auto_pick: boolean;
}

interface MemberRow {
  id: string;
  draft_seed: number;
}

export interface PickResult {
  pick: DraftPick;
  nextOnClock: QueueRow | null;
  draftCompleted: boolean;
}

// ── Errors ───────────────────────────────────────────────────────

export class DraftError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'DraftError';
  }
}

// ── Engine ───────────────────────────────────────────────────────

/**
 * Initialize a draft: generate the full pick queue from seeds.
 *
 * Call this when the commissioner starts the draft.
 * Seeds must already be assigned to all league members.
 */
export async function initializeDraft(draftId: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Fetch draft and league info
    const draftResult = await client.query<DraftRow>(
      `SELECT d.*, l.size, l.draft_type
       FROM drafts d JOIN leagues l ON l.id = d.league_id
       WHERE d.id = $1 FOR UPDATE`,
      [draftId],
    );
    const draft = draftResult.rows[0];
    if (!draft) throw new DraftError('Draft not found', 'DRAFT_NOT_FOUND');
    if (draft.status !== 'scheduled') {
      throw new DraftError('Draft already started', 'DRAFT_ALREADY_STARTED');
    }

    // Fetch members ordered by seed
    const membersResult = await client.query<MemberRow>(
      `SELECT id, draft_seed FROM league_members
       WHERE league_id = $1 AND draft_seed IS NOT NULL
       ORDER BY draft_seed`,
      [draft.league_id],
    );
    const members = membersResult.rows;

    if (members.length !== (draft as any).size) {
      throw new DraftError(
        `Expected ${(draft as any).size} members with seeds, got ${members.length}`,
        'INCOMPLETE_SEEDS',
      );
    }

    // Generate queue based on draft type
    const draftType = (draft as any).draft_type;
    const orderFn = draftType === 'snake' ? generateSnakeOrder : generateLinearOrder;
    const queue = orderFn(members.length, draft.total_rounds);

    // Bulk insert the queue
    const values: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;

    for (const entry of queue) {
      const member = members[entry.memberIndex];
      values.push(
        `($${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++})`,
      );
      params.push(draftId, entry.overallPick, entry.round, entry.pickInRound, member.id);
    }

    await client.query(
      `INSERT INTO draft_queue (draft_id, overall_pick, round, pick_in_round, member_id)
       VALUES ${values.join(', ')}`,
      params,
    );

    // Update draft status
    await client.query(
      `UPDATE drafts SET status = 'in_progress', started_at = now(),
       pick_timer_started_at = now() WHERE id = $1`,
      [draftId],
    );

    // Update league status
    await client.query(
      `UPDATE leagues SET status = 'drafting', updated_at = now()
       WHERE id = $1`,
      [draft.league_id],
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Execute a draft pick.
 *
 * This is the critical path — must be atomic and fast.
 * Uses advisory lock on the draft ID to serialize concurrent pick attempts.
 *
 * Flow:
 * 1. Acquire advisory lock on draft_id
 * 2. Verify it's this member's turn (current_pick matches queue entry)
 * 3. Verify player isn't already drafted
 * 4. Single-row UPDATE on draft_queue to claim the pick
 * 5. INSERT immutable pick event
 * 6. Advance draft_queue current_pick
 * 7. Release lock (on COMMIT)
 */
export async function makePick(
  draftId: string,
  memberId: string,
  playerId: number,
  autoPick: boolean = false,
): Promise<PickResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    return await withAdvisoryLock(client, draftId, async () => {
      // 1. Get current draft state
      const draftResult = await client.query<DraftRow>(
        `SELECT * FROM drafts WHERE id = $1`,
        [draftId],
      );
      const draft = draftResult.rows[0];
      if (!draft) throw new DraftError('Draft not found', 'DRAFT_NOT_FOUND');
      if (draft.status !== 'in_progress') {
        throw new DraftError('Draft is not in progress', 'DRAFT_NOT_ACTIVE');
      }

      // 2. Get current queue entry
      const queueResult = await client.query<QueueRow>(
        `SELECT * FROM draft_queue
         WHERE draft_id = $1 AND overall_pick = $2`,
        [draftId, draft.current_pick],
      );
      const currentEntry = queueResult.rows[0];
      if (!currentEntry) {
        throw new DraftError('No current pick found', 'NO_CURRENT_PICK');
      }

      // 3. Verify it's this member's turn (or auto-pick)
      if (!autoPick && currentEntry.member_id !== memberId) {
        throw new DraftError('Not your turn', 'NOT_YOUR_TURN');
      }

      // 4. Verify player exists and isn't drafted
      const playerCheck = await client.query(
        `SELECT id FROM players WHERE id = $1`,
        [playerId],
      );
      if (playerCheck.rows.length === 0) {
        throw new DraftError('Player not found', 'PLAYER_NOT_FOUND');
      }

      const draftedCheck = await client.query(
        `SELECT 1 FROM draft_queue
         WHERE draft_id = $1 AND player_id = $2`,
        [draftId, playerId],
      );
      if (draftedCheck.rows.length > 0) {
        throw new DraftError('Player already drafted', 'PLAYER_ALREADY_DRAFTED');
      }

      // 5. Validate positional constraints for this member
      await validatePositionalConstraints(client, currentEntry.member_id, playerId);

      // 6. THE ATOMIC PICK: single-row UPDATE
      await client.query(
        `UPDATE draft_queue
         SET player_id = $1, picked_at = now(), auto_pick = $2
         WHERE draft_id = $3 AND overall_pick = $4`,
        [playerId, autoPick, draftId, draft.current_pick],
      );

      // 7. Insert immutable pick event
      const pickResult = await client.query<{
        id: string;
        picked_at: string;
      }>(
        `INSERT INTO draft_picks (draft_id, overall_pick, member_id, player_id, auto_pick)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, picked_at`,
        [draftId, draft.current_pick, currentEntry.member_id, playerId, autoPick],
      );

      // 8. Add to roster
      const positionResult = await client.query<{ position: string }>(
        `SELECT position FROM players WHERE id = $1`,
        [playerId],
      );
      await client.query(
        `INSERT INTO rosters (member_id, player_id, slot, bench_order)
         VALUES ($1, $2, $3, NULL)`,
        [currentEntry.member_id, playerId, positionResult.rows[0].position],
      );

      // 9. Insert transaction log
      await client.query(
        `INSERT INTO transactions (league_id, member_id, type, player_in_id, source_id)
         SELECT d.league_id, $2, 'draft', $3, $4
         FROM drafts d WHERE d.id = $1`,
        [draftId, currentEntry.member_id, playerId, pickResult.rows[0].id],
      );

      // 10. Advance draft
      const totalPicks = draft.total_rounds * (await getLeagueSize(client, draftId));
      const nextPick = draft.current_pick + 1;
      const draftCompleted = nextPick > totalPicks;

      if (draftCompleted) {
        await client.query(
          `UPDATE drafts SET status = 'completed', completed_at = now(),
           current_pick = $2 WHERE id = $1`,
          [draftId, draft.current_pick],
        );
        // Update league to active
        await client.query(
          `UPDATE leagues SET status = 'active', updated_at = now()
           WHERE id = (SELECT league_id FROM drafts WHERE id = $1)`,
          [draftId],
        );
      } else {
        const nextRound = Math.ceil(nextPick / (await getLeagueSize(client, draftId)));
        await client.query(
          `UPDATE drafts SET current_pick = $2, current_round = $3,
           pick_timer_started_at = now() WHERE id = $1`,
          [draftId, nextPick, nextRound],
        );
      }

      // 11. Get next on clock (if draft not completed)
      let nextOnClock: QueueRow | null = null;
      if (!draftCompleted) {
        const nextResult = await client.query<QueueRow>(
          `SELECT * FROM draft_queue
           WHERE draft_id = $1 AND overall_pick = $2`,
          [draftId, nextPick],
        );
        nextOnClock = nextResult.rows[0] ?? null;
      }

      await client.query('COMMIT');

      return {
        pick: {
          id: pickResult.rows[0].id,
          draftId,
          overallPick: draft.current_pick,
          memberId: currentEntry.member_id,
          playerId,
          autoPick,
          pickedAt: pickResult.rows[0].picked_at,
        },
        nextOnClock,
        draftCompleted,
      };
    });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Validate that a member can draft this player without violating
 * FPL squad constraints:
 * - Max 3 from any club
 * - Positional limits (2 GKP, 5 DEF, 5 MID, 3 FWD)
 */
async function validatePositionalConstraints(
  client: pg.PoolClient,
  memberId: string,
  playerId: number,
): Promise<void> {
  // Get the player's position and club
  const playerResult = await client.query<{ position: string; club_code: string }>(
    `SELECT position, club_code FROM players WHERE id = $1`,
    [playerId],
  );
  const player = playerResult.rows[0];
  if (!player) throw new DraftError('Player not found', 'PLAYER_NOT_FOUND');

  // Check club limit (max 3)
  const clubCount = await client.query<{ count: string }>(
    `SELECT COUNT(*) as count FROM rosters r
     JOIN players p ON p.id = r.player_id
     WHERE r.member_id = $1 AND p.club_code = $2`,
    [memberId, player.club_code],
  );
  if (parseInt(clubCount.rows[0].count) >= 3) {
    throw new DraftError(
      `Already have 3 players from ${player.club_code}`,
      'CLUB_LIMIT_EXCEEDED',
    );
  }

  // Check positional limit
  const posLimits: Record<string, number> = { GKP: 2, DEF: 5, MID: 5, FWD: 3 };
  const posCount = await client.query<{ count: string }>(
    `SELECT COUNT(*) as count FROM rosters r
     JOIN players p ON p.id = r.player_id
     WHERE r.member_id = $1 AND p.position = $2`,
    [memberId, player.position],
  );
  if (parseInt(posCount.rows[0].count) >= posLimits[player.position]) {
    throw new DraftError(
      `Already have max ${player.position} players`,
      'POSITION_LIMIT_EXCEEDED',
    );
  }
}

async function getLeagueSize(client: pg.PoolClient, draftId: string): Promise<number> {
  const result = await client.query<{ size: number }>(
    `SELECT l.size FROM leagues l
     JOIN drafts d ON d.league_id = l.id
     WHERE d.id = $1`,
    [draftId],
  );
  return result.rows[0].size;
}

/**
 * Get the current draft state for a client.
 */
export async function getDraftState(draftId: string) {
  const [draftResult, queueResult, picksResult] = await Promise.all([
    pool.query<DraftRow>('SELECT * FROM drafts WHERE id = $1', [draftId]),
    pool.query<QueueRow>(
      'SELECT * FROM draft_queue WHERE draft_id = $1 ORDER BY overall_pick',
      [draftId],
    ),
    pool.query(
      'SELECT * FROM draft_picks WHERE draft_id = $1 ORDER BY overall_pick',
      [draftId],
    ),
  ]);

  const draft = draftResult.rows[0];
  if (!draft) throw new DraftError('Draft not found', 'DRAFT_NOT_FOUND');

  const queue = queueResult.rows;
  const picks = picksResult.rows;
  const draftedPlayerIds = new Set(picks.map((p: any) => p.player_id));

  // Current on the clock
  const currentEntry = queue.find((q) => q.overall_pick === draft.current_pick);
  const onTheClock = currentEntry?.member_id ?? null;

  // Time remaining
  let timeRemaining: number | null = null;
  if (draft.status === 'in_progress' && draft.pick_timer_started_at) {
    const elapsed = (Date.now() - new Date(draft.pick_timer_started_at).getTime()) / 1000;
    timeRemaining = Math.max(0, draft.pick_timer_seconds - elapsed);
  }

  return {
    draft,
    queue,
    picks,
    draftedPlayerIds,
    onTheClock,
    timeRemaining,
  };
}
