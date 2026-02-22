import type { ProjectionEngine } from './engine.js';
import { HeuristicEngine } from './heuristic.js';
import { AiEngine } from './ai.js';

export { ProjectionEngine } from './engine.js';
export { HeuristicEngine } from './heuristic.js';
export { AiEngine } from './ai.js';

/**
 * Factory: create the right engine from config.
 *
 *   'heuristic' — fast, uses FPL form/PPG/FDR (default)
 *   'ai'        — LLM-powered context-aware projections (stubbed)
 */
export function createEngine(type: string = 'heuristic'): ProjectionEngine {
  switch (type) {
    case 'heuristic':
      return new HeuristicEngine();
    case 'ai':
      return new AiEngine({
        provider: process.env.AI_PROVIDER ?? 'anthropic',
        model: process.env.AI_MODEL ?? 'claude-sonnet-4-5-20250929',
        apiKey: process.env.AI_API_KEY ?? '',
      });
    default:
      throw new Error(`Unknown projection engine: "${type}". Valid: heuristic, ai`);
  }
}
