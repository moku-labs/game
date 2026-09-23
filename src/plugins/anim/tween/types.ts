/**
 * @file anim/tween — type definitions of the one track table: what a track holds while it runs
 * and the handle a caller drives it with.
 */
import type { AnyComponent } from "../../world/ecs/types";
import type { Ease, Entity, MotionHandle, TrackSegment } from "../../world/types";

/**
 * One running track: the numeric fields of one component of one entity moving from the values
 * read at the end of the delay to the exact target, straight or through keyframe segments. A
 * track with repeats walks again from its first segment each time a run ends.
 *
 * @example
 * ```ts
 * const track: Track = {
 *   id: 1, entity: 1_048_576, component: Transform, to: { x: 200 },
 *   keys: { x: "1048576:Transform:x" }, ms: 350, ease: "out", delayMs: 0, elapsed: 0,
 *   from: undefined, muted: () => new Set(), additive: false, driven: false, bornFrame: 4,
 *   ended: false, segments: undefined, repeatsLeft: 0, held: false
 * };
 * ```
 */
export type Track = {
  readonly id: number;
  readonly entity: Entity;
  readonly component: AnyComponent;
  /** The target fields. Retarget deletes the fields a newer absolute track took over. */
  to: Record<string, number>;
  /**
   * The key of the owner, bases and offsets tables per field, built once when the track starts.
   * It keeps a field `to` lost, which nothing reads again.
   */
  readonly keys: Readonly<Record<string, string>>;
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
  /**
   * The keyframe segments the track walks over `ms`, or `undefined` for a straight track. A
   * segment without an ease runs on the track's `ease`.
   */
  readonly segments: readonly TrackSegment[] | undefined;
  /**
   * The runs still to go after the one that plays: `0` for a track that runs once, `Infinity`
   * for a loop (`repeat: "forever"`), which never ends by itself.
   */
  repeatsLeft: number;
  /**
   * True while a loop stands on its first key and has written it: the hold writes once, and the
   * walk clears it, so the next hold writes the first key again.
   */
  held: boolean;
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
