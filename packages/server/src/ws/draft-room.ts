import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import type { ClientEvent, ServerEvent } from '@pitch-draft/shared';
import { makePick, getDraftState, DraftError, draftTimerManager } from '../draft/index.js';
import type { PickResult } from '../draft/index.js';

interface ConnectedClient {
  ws: WebSocket;
  memberId: string;
  draftId: string;
}

/**
 * Draft room WebSocket manager.
 *
 * Each draft has a "room" of connected clients.
 * Events are broadcast to all members of the draft.
 */
class DraftRoomManager {
  /** draftId -> Set of connected clients */
  private rooms = new Map<string, Set<ConnectedClient>>();

  constructor() {
    // Wire up auto-pick broadcast
    draftTimerManager.onPick((result) => {
      this.broadcastPick(result);
    });
  }

  addClient(draftId: string, memberId: string, ws: WebSocket): void {
    if (!this.rooms.has(draftId)) {
      this.rooms.set(draftId, new Set());
    }
    const client: ConnectedClient = { ws, memberId, draftId };
    this.rooms.get(draftId)!.add(client);

    // Broadcast presence
    this.broadcast(draftId, {
      type: 's:member_presence',
      draftId,
      memberId,
      online: true,
    });

    // Clean up on disconnect
    ws.on('close', () => {
      this.rooms.get(draftId)?.delete(client);
      this.broadcast(draftId, {
        type: 's:member_presence',
        draftId,
        memberId,
        online: false,
      });
    });
  }

  broadcast(draftId: string, event: ServerEvent): void {
    const room = this.rooms.get(draftId);
    if (!room) return;

    const data = JSON.stringify(event);
    for (const client of room) {
      if (client.ws.readyState === 1) { // WebSocket.OPEN
        client.ws.send(data);
      }
    }
  }

  broadcastPick(result: PickResult): void {
    this.broadcast(result.pick.draftId, {
      type: 's:pick_made',
      pick: result.pick,
      nextOnClock: result.nextOnClock as any,
      serverTimestamp: new Date().toISOString(),
    });

    if (result.draftCompleted) {
      this.broadcast(result.pick.draftId, {
        type: 's:draft_completed',
        draftId: result.pick.draftId,
      });
    }
  }

  getOnlineMembers(draftId: string): string[] {
    const room = this.rooms.get(draftId);
    if (!room) return [];
    return [...new Set([...room].map((c) => c.memberId))];
  }
}

export const draftRoomManager = new DraftRoomManager();

/**
 * Register WebSocket routes for the draft room.
 */
export async function registerDraftWebSocket(app: FastifyInstance): Promise<void> {
  app.get('/ws/draft/:draftId', { websocket: true }, async (socket, req) => {
    const { draftId } = req.params as { draftId: string };

    // TODO: authenticate the connection and extract memberId from JWT
    // For now, require memberId as query param
    const memberId = (req.query as any).memberId as string;
    if (!memberId) {
      socket.close(4001, 'Missing memberId');
      return;
    }

    draftRoomManager.addClient(draftId, memberId, socket);

    // Send current state on connect
    try {
      const state = await getDraftState(draftId);
      socket.send(JSON.stringify({
        type: 's:draft_started',
        draftId,
        firstOnClock: state.queue.find((q) => q.overall_pick === state.draft.current_pick) ?? null,
        serverTimestamp: new Date().toISOString(),
      }));
    } catch (err) {
      socket.close(4004, 'Draft not found');
      return;
    }

    // Handle incoming messages
    socket.on('message', async (raw: Buffer) => {
      let event: ClientEvent;
      try {
        event = JSON.parse(raw.toString()) as ClientEvent;
      } catch {
        socket.send(JSON.stringify({
          type: 's:pick_error',
          message: 'Invalid JSON',
          playerId: 0,
        }));
        return;
      }

      switch (event.type) {
        case 'c:make_pick': {
          try {
            const result = await makePick(event.draftId, memberId, event.playerId);
            draftRoomManager.broadcastPick(result);

            // Restart timer for next pick
            if (!result.draftCompleted) {
              await draftTimerManager.startTimer(event.draftId);
            } else {
              draftTimerManager.clearTimer(event.draftId);
            }
          } catch (err) {
            if (err instanceof DraftError) {
              socket.send(JSON.stringify({
                type: 's:pick_error',
                message: err.message,
                playerId: event.playerId,
              } satisfies ServerEvent));
            } else {
              console.error('Pick error:', err);
              socket.send(JSON.stringify({
                type: 's:pick_error',
                message: 'Internal error',
                playerId: event.playerId,
              }));
            }
          }
          break;
        }

        case 'c:set_auto_pick': {
          // Store the member's auto-pick rankings
          try {
            await storeAutoPickRankings(event.draftId, memberId, event.rankings);
          } catch (err) {
            console.error('Failed to store auto-pick rankings:', err);
          }
          break;
        }

        // c:join_draft and c:leave_draft handled by connection lifecycle
      }
    });
  });
}

async function storeAutoPickRankings(
  draftId: string,
  memberId: string,
  rankings: number[],
): Promise<void> {
  const { pool: dbPool } = await import('../db/pool.js');
  const client = await dbPool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'DELETE FROM auto_pick_rankings WHERE draft_id = $1 AND member_id = $2',
      [draftId, memberId],
    );

    if (rankings.length > 0) {
      const values: string[] = [];
      const params: unknown[] = [];
      let idx = 1;

      for (let i = 0; i < rankings.length; i++) {
        values.push(`($${idx++}, $${idx++}, $${idx++}, $${idx++})`);
        params.push(draftId, memberId, rankings[i], i + 1);
      }

      await client.query(
        `INSERT INTO auto_pick_rankings (draft_id, member_id, player_id, rank)
         VALUES ${values.join(', ')}`,
        params,
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
