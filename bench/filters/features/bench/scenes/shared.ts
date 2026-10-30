/**
 * @file What the scenes share: the texture, a full-screen sprite, the loops.
 */
import { Sprite, Transform, type World } from "../../../../../src/index.ts";
import type { Stage } from "./types";

/** The texture of every sprite: the same one keeps them in one batch. */
export const PICTURE = "ui.fx-spark";

/**
 * A sprite that covers the screen.
 *
 * @param stage - The stage.
 * @returns The sprite.
 */
export function fullSprite(stage: Stage): World.Entity {
  return stage.spawn(
    Transform({ x: 0, y: 0 }),
    Sprite({
      texture: PICTURE,
      width: stage.width,
      height: stage.height,
      anchor: { x: 0, y: 0 }
    })
  );
}

/**
 * Where a loop stands.
 *
 * @param elapsedMs - The time.
 * @param periodMs - One turn.
 * @returns From 0 to 1.
 * @example
 * ```ts
 * loop(2500, 1000); // 0.5
 * ```
 */
export function loop(elapsedMs: number, periodMs: number): number {
  return (elapsedMs % periodMs) / periodMs;
}

/**
 * A ramp held at both ends: 0, then 1 over `ramp`, then 1 until the turn ends.
 *
 * @param at - Where the loop stands, 0 to 1.
 * @param ramp - The share of the turn the ramp takes.
 * @returns From 0 to 1.
 * @example
 * ```ts
 * ramped(0.25, 0.5); // 0.5
 * ```
 */
export function ramped(at: number, ramp: number): number {
  return Math.min(at / ramp, 1);
}
