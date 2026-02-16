import { pool } from '../db/pool.js';
import { executeAutoPick } from './auto-pick.js';
import type { PickResult } from './draft-engine.js';

type TimerCallback = (result: PickResult) => void;

interface ActiveTimer {
  draftId: string;
  timeout: ReturnType<typeof setTimeout>;
  expiresAt: number;
}

/**
 * Draft timer manager.
 *
 * One timer per active draft. When the timer fires,
 * it triggers an auto-pick for the current on-the-clock member.
 *
 * Timer is server-authoritative. Clients receive timer_update events
 * for display, but the server is the source of truth.
 */
export class DraftTimerManager {
  private timers = new Map<string, ActiveTimer>();
  private onPickCallback: TimerCallback | null = null;

  onPick(callback: TimerCallback): void {
    this.onPickCallback = callback;
  }

  /**
   * Start or restart the timer for a draft.
   * Called after each pick to start the next player's clock.
   */
  async startTimer(draftId: string): Promise<void> {
    this.clearTimer(draftId);

    const result = await pool.query<{
      pick_timer_seconds: number;
      pick_timer_started_at: string;
      current_pick: number;
      status: string;
    }>(
      `SELECT pick_timer_seconds, pick_timer_started_at, current_pick, status
       FROM drafts WHERE id = $1`,
      [draftId],
    );

    const draft = result.rows[0];
    if (!draft || draft.status !== 'in_progress') return;

    const startedAt = new Date(draft.pick_timer_started_at).getTime();
    const expiresAt = startedAt + draft.pick_timer_seconds * 1000;
    const remaining = expiresAt - Date.now();

    if (remaining <= 0) {
      // Timer already expired — auto-pick immediately
      await this.handleExpiry(draftId);
      return;
    }

    const timeout = setTimeout(
      () => this.handleExpiry(draftId),
      remaining,
    );

    this.timers.set(draftId, { draftId, timeout, expiresAt });
  }

  /**
   * Clear a draft's timer (e.g. on pause or completion).
   */
  clearTimer(draftId: string): void {
    const timer = this.timers.get(draftId);
    if (timer) {
      clearTimeout(timer.timeout);
      this.timers.delete(draftId);
    }
  }

  /**
   * Get seconds remaining for a draft.
   */
  getTimeRemaining(draftId: string): number | null {
    const timer = this.timers.get(draftId);
    if (!timer) return null;
    return Math.max(0, (timer.expiresAt - Date.now()) / 1000);
  }

  /**
   * Clear all timers (shutdown).
   */
  clearAll(): void {
    for (const [, timer] of this.timers) {
      clearTimeout(timer.timeout);
    }
    this.timers.clear();
  }

  private async handleExpiry(draftId: string): Promise<void> {
    this.timers.delete(draftId);

    try {
      // Get who's on the clock
      const result = await pool.query<{ member_id: string; current_pick: number }>(
        `SELECT dq.member_id, d.current_pick
         FROM drafts d
         JOIN draft_queue dq ON dq.draft_id = d.id AND dq.overall_pick = d.current_pick
         WHERE d.id = $1 AND d.status = 'in_progress'`,
        [draftId],
      );

      if (result.rows.length === 0) return;

      const { member_id } = result.rows[0];
      const pickResult = await executeAutoPick(draftId, member_id);

      // Notify via callback (WebSocket broadcast)
      if (this.onPickCallback) {
        this.onPickCallback(pickResult);
      }

      // Start next timer if draft continues
      if (!pickResult.draftCompleted) {
        await this.startTimer(draftId);
      }
    } catch (err) {
      console.error(`Auto-pick failed for draft ${draftId}:`, err);
      // TODO: pause draft and notify commissioner
    }
  }
}

export const draftTimerManager = new DraftTimerManager();
