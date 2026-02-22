import type { Position } from '@pitch-draft/shared';
import type { PlayerProjection, ProjectionContext } from '../types.js';

/**
 * Abstract projection engine.
 *
 * Strategy pattern — swap implementations without changing callers:
 *   HeuristicEngine  → fast, uses FPL's own data (form, PPG, FDR)
 *   AiEngine (future) → calls an LLM with context (news, fixtures, trends)
 *
 * Both produce identical output shapes.
 */
export abstract class ProjectionEngine {
  abstract readonly name: string;

  /**
   * Project a single player's rest-of-season value.
   *
   * Implementations must handle:
   * - Blank gameweeks (team has no fixture → 0 pts that GW)
   * - Double gameweeks (team has 2 fixtures → 2× pts that GW)
   * - Injuries (chance_of_playing scales projection)
   * - Fixture difficulty (FDR 1–5 adjusts expected output)
   */
  abstract projectPlayer(
    playerId: number,
    context: ProjectionContext,
  ): PlayerProjection;

  /**
   * Positional scarcity multiplier for trade/waiver value assessment.
   * Scarce positions return > 1.0, surplus positions < 1.0.
   */
  abstract getPositionalScarcity(
    position: Position,
    context: ProjectionContext,
  ): number;

  projectRoster(playerIds: number[], context: ProjectionContext): PlayerProjection[] {
    return playerIds.map((id) => this.projectPlayer(id, context));
  }

  adjustForScarcity(projection: PlayerProjection, context: ProjectionContext): number {
    return projection.ros * this.getPositionalScarcity(projection.position, context);
  }
}
