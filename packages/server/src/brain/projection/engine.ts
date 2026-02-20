import type { PlayerProjection, ProjectionContext } from '../types.js';

/**
 * Abstract base for all projection engines.
 *
 * Why a class instead of plain functions?
 * → The AI engine (future) will carry state (model config, prompt cache, etc).
 * → The strategy pattern lets us swap engines via config without changing callers.
 *
 * To add a new engine:
 * 1. Extend ProjectionEngine
 * 2. Implement projectPlayer() and getPositionalScarcity()
 * 3. Register it in the factory (projection/index.ts)
 */
export abstract class ProjectionEngine {
  /** Friendly name shown in API responses so callers know which engine produced the result. */
  abstract readonly name: string;

  /**
   * Project a single player's rest-of-season value.
   *
   * @param playerId - Sleeper player ID
   * @param context  - League scoring, weekly stats, player metadata, current week
   */
  abstract projectPlayer(
    playerId: string,
    context: ProjectionContext,
  ): PlayerProjection;

  /**
   * Positional scarcity multiplier.
   * A scarce position (TE in most leagues) returns > 1.0,
   * meaning players at that position are worth more in trade value.
   * Surplus positions (K, DEF) return < 1.0.
   */
  abstract getPositionalScarcity(
    position: string,
    context: ProjectionContext,
  ): number;

  /**
   * Project all players on a roster.
   * Default implementation calls projectPlayer() for each.
   */
  projectRoster(
    playerIds: string[],
    context: ProjectionContext,
  ): PlayerProjection[] {
    return playerIds.map((id) => this.projectPlayer(id, context));
  }

  /**
   * Calculate scarcity-adjusted value: raw ROS * scarcity multiplier.
   */
  adjustForScarcity(
    projection: PlayerProjection,
    context: ProjectionContext,
  ): number {
    const mult = this.getPositionalScarcity(projection.position, context);
    return projection.ros * mult;
  }
}
