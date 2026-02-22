import type { Position } from '@pitch-draft/shared';
import { ProjectionEngine } from './engine.js';
import type { PlayerProjection, ProjectionContext } from '../types.js';

/**
 * AI-powered projection engine — stubbed, ready for implementation.
 *
 * The interface matches HeuristicEngine exactly. When built out:
 * 1. Build context prompt (player stats, fixtures, injury news, form trends)
 * 2. Call an LLM (Claude) for a reasoned projection
 * 3. Parse structured response into PlayerProjection
 *
 * Enable via: PROJECTION_ENGINE=ai + AI_API_KEY=sk-...
 */
export class AiEngine extends ProjectionEngine {
  readonly name = 'ai';

  constructor(
    private config: {
      provider: string;
      model: string;
      apiKey: string;
    },
  ) {
    super();
  }

  projectPlayer(playerId: number, _ctx: ProjectionContext): PlayerProjection {
    if (!this.config.apiKey) {
      throw Object.assign(
        new Error('AI engine requires an API key. Set AI_API_KEY or use PROJECTION_ENGINE=heuristic.'),
        { status: 400, code: 'AI_NOT_CONFIGURED' },
      );
    }

    // TODO: Implement AI projections
    //
    // Prompt context should include:
    // - Player season stats, form, ICT index
    // - Upcoming fixture difficulty + opponents
    // - Injury status and news text
    // - Position-specific factors (CS odds for DEF, goal threat for FWD)
    // - Blank/double GW schedule
    //
    // Expected structured response: { ppg, ros, confidence, reasoning }

    throw Object.assign(
      new Error(`AI engine (${this.config.provider}/${this.config.model}) not yet implemented. Use PROJECTION_ENGINE=heuristic.`),
      { status: 501, code: 'AI_NOT_IMPLEMENTED' },
    );
  }

  getPositionalScarcity(position: Position, _ctx: ProjectionContext): number {
    const scarcity: Record<string, number> = { GKP: 0.6, DEF: 1.0, MID: 1.15, FWD: 1.35 };
    return scarcity[position] ?? 1.0;
  }
}
