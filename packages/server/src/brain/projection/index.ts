import type { ProjectionEngine } from './engine.js';
import { HeuristicEngine } from './heuristic.js';

export { ProjectionEngine } from './engine.js';
export { HeuristicEngine } from './heuristic.js';

/**
 * Factory: create the right projection engine from a config string.
 *
 * Currently supported:
 *   'heuristic' — fast, no external calls, good enough for 90% of use cases.
 *
 * Future:
 *   'ai' — calls an LLM for context-aware projections (injury news, matchups, etc).
 *
 * To add a new engine, implement ProjectionEngine and add a case here.
 */
export function createEngine(type: string = 'heuristic'): ProjectionEngine {
  switch (type) {
    case 'heuristic':
      return new HeuristicEngine();

    // case 'ai':
    //   return new AiEngine({ provider, model, apiKey });

    default:
      throw new Error(`Unknown projection engine: "${type}". Valid: heuristic`);
  }
}
