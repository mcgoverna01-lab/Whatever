import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { initializeDraft, getDraftState, makePick, DraftError } from '../draft/index.js';
import { draftTimerManager } from '../draft/index.js';

const StartDraftSchema = z.object({
  draftId: z.string().uuid(),
});

const MakePickSchema = z.object({
  draftId: z.string().uuid(),
  memberId: z.string().uuid(),
  playerId: z.number().int().positive(),
});

export async function registerDraftRoutes(app: FastifyInstance): Promise<void> {
  // Start a draft (commissioner action)
  app.post('/api/drafts/:draftId/start', async (req, reply) => {
    const { draftId } = StartDraftSchema.parse(req.params);

    try {
      await initializeDraft(draftId);
      await draftTimerManager.startTimer(draftId);

      const state = await getDraftState(draftId);
      return reply.code(200).send(state);
    } catch (err) {
      if (err instanceof DraftError) {
        return reply.code(400).send({ error: err.code, message: err.message });
      }
      throw err;
    }
  });

  // Get current draft state
  app.get('/api/drafts/:draftId', async (req, reply) => {
    const { draftId } = z.object({ draftId: z.string().uuid() }).parse(req.params);

    try {
      const state = await getDraftState(draftId);
      // Convert Set to array for JSON serialization
      return reply.send({
        ...state,
        draftedPlayerIds: [...state.draftedPlayerIds],
      });
    } catch (err) {
      if (err instanceof DraftError) {
        return reply.code(404).send({ error: err.code, message: err.message });
      }
      throw err;
    }
  });

  // Make a pick (REST fallback — WebSocket is preferred)
  app.post('/api/drafts/:draftId/pick', async (req, reply) => {
    const params = z.object({ draftId: z.string().uuid() }).parse(req.params);
    const body = z.object({
      memberId: z.string().uuid(),
      playerId: z.number().int().positive(),
    }).parse(req.body);

    try {
      const result = await makePick(params.draftId, body.memberId, body.playerId);

      if (!result.draftCompleted) {
        await draftTimerManager.startTimer(params.draftId);
      } else {
        draftTimerManager.clearTimer(params.draftId);
      }

      return reply.code(200).send(result);
    } catch (err) {
      if (err instanceof DraftError) {
        return reply.code(400).send({ error: err.code, message: err.message });
      }
      throw err;
    }
  });
}
