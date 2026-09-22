/**
 * @file anim/tween — type definitions of the one track table: what a track holds while it runs
 * and the handle a caller drives it with.
 */
import type { AnyComponent } from "../../world/ecs/types";
import type { Ease, Entity, MotionHandle } from "../../world/types";

/**
 * One running track: the numeric fields of one component of one entity moving from the values
 * read at the end of the delay to the exact target.
 *
 * @example
 * ```ts
 * const track: Track = {
 *   id: 1, entity: 1_048_576, component: Transform, to: { x: 200 }, ms: 350, ease: "out",
 *   delayMs: 0, elapsed: 0, from: undefined, muted: () => new Set(), additive: false,
 *   driven: false, bornFrame: 4, ended: false
 * };
 * ```
 */
export type Track = {
  readonly id: number;
  readonly entity: Entity;
  readonly component: AnyComponent;
  /** The target fields. Retarget deletes the fields a newer absolute track took over. */
  to: Record<string, number>;
  readonly ms: number;
  readonly ease: Ease;
  readonly delayMs: number;
  elapsed: number;
  /** Read when the delay ends, never earlier. */
  from: Record<string, number> | undefined;
  readonly muted: () => ReadonlySet<string>;
  readonly additive: boolean;
  /** True for a track a timeline step advances by hand; the frame step leaves it alone. */
  readonly driven: boolean;
  /** The frame step the track was born in. That step does not advance it a second time. */
  readonly bornFrame: number;
  ended: boolean;
};

/**
 * A motion handle that can also be advanced by hand: what the timeline cursor needs, so a track
 * born inside a frame step still consumes the remainder of that step's delta.
 *
 * @example
 * ```ts
 * const motion: StepMotion = { ...inert, advance: () => 0 };
 * motion.advance(16); // 0: nothing is left over
 * ```
 */
export type StepMotion = MotionHandle & {
  /**
   * Advances the track by one delta.
   *
   * @param deltaMs - Milliseconds of game time to consume.
   * @returns The milliseconds left over past the end of the track.
   */
  advance(deltaMs: number): number;
};
