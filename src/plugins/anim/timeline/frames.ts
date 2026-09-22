/**
 * @file anim/timeline — the frame sprite step: which texture key of the list is on the screen at
 * a given point of the step, and how it is written. No sheets in V3: a frame is one asset key,
 * and `renderer` swaps the texture behind it.
 */
import { Sprite } from "../../renderer/components";
import type { Entity } from "../../world/types";
import { asComponent } from "../components";
import type { TimelineRuntime } from "./types";

/**
 * How long one key of the list is on the screen.
 *
 * @param fps - Frames per second of the list.
 * @returns The duration of one key, in game milliseconds.
 * @example
 * ```ts
 * frameMsOf(10); // 100
 * ```
 */
export function frameMsOf(fps: number): number {
  return fps > 0 ? 1000 / fps : 0;
}

/**
 * How long the whole list takes once.
 *
 * @param keys - The texture keys.
 * @param fps - Frames per second of the list.
 * @returns The duration of the list, in game milliseconds.
 * @example
 * ```ts
 * framesDurationMs(["a", "b", "c"], 10); // 300
 * ```
 */
export function framesDurationMs(keys: readonly string[], fps: number): number {
  return keys.length * frameMsOf(fps);
}

/**
 * Which key of the list belongs to a point of the step. A looping list wraps; a list that plays
 * once stops on its last key.
 *
 * @param keys - The texture keys.
 * @param fps - Frames per second of the list.
 * @param loop - True when the list repeats.
 * @param elapsed - Consumed milliseconds of the step.
 * @returns The index into `keys`.
 * @example
 * ```ts
 * frameIndexAt(["a", "b", "c"], 10, false, 150); // 1
 * frameIndexAt(["a", "b"], 10, true, 350); // 1
 * ```
 */
export function frameIndexAt(
  keys: readonly string[],
  fps: number,
  loop: boolean,
  elapsed: number
): number {
  const frameMs = frameMsOf(fps);
  const raw = frameMs > 0 ? Math.floor(elapsed / frameMs) : keys.length - 1;

  if (loop) return ((raw % keys.length) + keys.length) % keys.length;

  return Math.min(Math.max(raw, 0), keys.length - 1);
}

/**
 * Writes one texture key onto the sprite of an entity.
 *
 * @param rt - The timeline runtime.
 * @param entity - The entity to write.
 * @param key - The texture key.
 */
export function writeFrame(rt: TimelineRuntime, entity: Entity, key: string): void {
  rt.write(entity, asComponent(Sprite), { texture: key });
}
