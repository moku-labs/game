/**
 * @file anim plugin — the keyframe tracks of `defineMotion`: the definition-time check of a track
 * and the enter and exit walks. One tween with segments per component the keys name, composed
 * with `view.all`, so the whole walk runs on one clock of the driver `world` hands the tween to.
 * Pure, no ctx.
 */
import type { TransformValue } from "../renderer/components";
import { NineSlice, Shape, Sprite, Transform } from "../renderer/components";
import type { AnyComponent } from "../world/ecs/types";
import type { ComponentType, Ease, Motion, TrackSegment, ViewHandle } from "../world/types";
import { asComponent } from "./components";
import type { MotionKeyframe } from "./types";

/** The curve of a segment whose key names none. */
const KEY_EASE: Ease = "inOut";

/** The numeric fields one key gives one component, as absolute values. */
type KeyPose = Record<string, number>;

/**
 * One component a key may name, as the view carries it: the type to write, the rest fields and
 * how a key reads against them.
 */
type Lane = {
  readonly component: AnyComponent;
  readonly rest: KeyPose;
  pose(key: MotionKeyframe): KeyPose;
};

/**
 * Checks one keyframe track at definition time: it has a key, every `at` lies in 0..1 and each
 * key comes after the one before.
 *
 * @param name - The track name, for the error.
 * @param keys - The keys of the track.
 * @throws {Error} When the track has no key, a key outside 0..1 or two keys out of order.
 */
export function checkTrack(name: string, keys: readonly MotionKeyframe[]): void {
  if (keys.length === 0) {
    throw new Error(`[game] Motion track "${name}" has no keys.\n  Give it at least one key.`);
  }

  let previous = Number.NEGATIVE_INFINITY;

  for (const key of keys) {
    if (Number.isNaN(key.at) || key.at < 0 || key.at > 1) {
      throw new Error(
        `[game] Motion track "${name}" has a key at ${key.at}.\n  Keep every at between 0 and 1.`
      );
    }

    if (key.at <= previous) {
      throw new Error(
        `[game] Motion track "${name}" has its keys out of order at ${key.at}.\n  Sort the keys by at, each one after the one before.`
      );
    }

    previous = key.at;
  }
}

/**
 * The pose one key gives the Transform: `dx` and `dy` as positions from the rest pose, rotation
 * and scale as written.
 *
 * @param key - The key.
 * @param rest - The rest position of the view.
 * @returns The fields the key names.
 */
function transformPose(
  key: MotionKeyframe,
  rest: Readonly<Pick<TransformValue, "x" | "y">>
): KeyPose {
  const pose: KeyPose = {};
  const fields = key.Transform;

  if (fields?.dx !== undefined) pose.x = rest.x + fields.dx;
  if (fields?.dy !== undefined) pose.y = rest.y + fields.dy;
  if (fields?.rotation !== undefined) pose.rotation = fields.rotation;
  if (fields?.scale !== undefined) pose.scale = fields.scale;

  return pose;
}

/**
 * The lane of one component that a key names by its alpha alone.
 *
 * @param view - The view handle the hook was given.
 * @param name - The key field that names the component.
 * @param component - The component type.
 * @returns The lane, or `undefined` when the view does not carry the component.
 */
function alphaLane(
  view: ViewHandle<unknown>,
  name: "Shape" | "Sprite" | "NineSlice",
  component: ComponentType<{ alpha: number }>
): Lane | undefined {
  const rest = view.rest(component);

  if (rest === undefined) return undefined;

  return {
    component: asComponent(component),
    rest: { alpha: rest.alpha },
    pose: (key: MotionKeyframe): KeyPose => {
      const alpha = key[name]?.alpha;

      return alpha === undefined ? {} : { alpha };
    }
  };
}

/**
 * The lanes of a view: every component a key may name that the view carries.
 *
 * @param view - The view handle the hook was given.
 * @returns The lanes, Transform first.
 */
function lanesOf(view: ViewHandle<unknown>): Lane[] {
  const lanes: Lane[] = [];
  const transform = view.rest(Transform);

  if (transform !== undefined) {
    const { x, y, rotation, scale } = transform;

    lanes.push({
      component: asComponent(Transform),
      rest: { x, y, rotation, scale },
      pose: key => transformPose(key, { x, y })
    });
  }

  for (const lane of [
    alphaLane(view, "Shape", Shape),
    alphaLane(view, "Sprite", Sprite),
    alphaLane(view, "NineSlice", NineSlice)
  ]) {
    if (lane !== undefined) lanes.push(lane);
  }

  return lanes;
}

/**
 * The segments one lane walks: one per key, eased by the key's curve. A key that does not name a
 * field of the lane holds it.
 *
 * @param lane - The lane.
 * @param keys - The keys of the track.
 * @returns The segments, in key order.
 */
function segmentsOf(lane: Lane, keys: readonly MotionKeyframe[]): TrackSegment[] {
  return keys.map(key => ({ at: key.at, ease: key.ease ?? KEY_EASE, to: lane.pose(key) }));
}

/**
 * The last value each field reaches over a list of segments.
 *
 * @param segments - The segments of one lane.
 * @returns One value per field any segment names.
 * @example
 * ```ts
 * lastValues([{ at: 0.5, to: { y: 10, scale: 2 } }, { at: 1, to: { y: 0 } }]); // { y: 0, scale: 2 }
 * ```
 */
function lastValues(segments: readonly TrackSegment[]): KeyPose {
  const values: KeyPose = {};

  for (const segment of segments) Object.assign(values, segment.to);

  return values;
}

/**
 * The enter walk of one lane: the view is set to the first key, and walks the keys to the rest
 * pose at `at: 1`. A key at `at: 1` gives that last segment its curve; the pose there is rest.
 *
 * @param view - The view handle the hook was given.
 * @param lane - The lane.
 * @param keys - The keys of the track.
 * @param ms - The length of the whole track.
 * @returns The motion, or `undefined` when no key names the lane.
 */
function enterLane(
  view: ViewHandle<unknown>,
  lane: Lane,
  keys: readonly MotionKeyframe[],
  ms: number
): Motion {
  const segments = segmentsOf(lane, keys);
  const named = lastValues(segments);
  const rest: KeyPose = {};

  for (const [field, value] of Object.entries(lane.rest)) {
    if (Object.hasOwn(named, field)) rest[field] = value;
  }

  if (Object.keys(rest).length === 0) return undefined;

  view.set(lane.component, { ...rest, ...segments[0]?.to });

  const tail = segments.at(-1)?.at === 1 ? segments.pop() : undefined;

  segments.push({ at: 1, ease: tail?.ease ?? KEY_EASE, to: rest });

  return view.tween(lane.component, rest, { ms, ease: KEY_EASE, segments });
}

/**
 * The exit walk of one lane: from where the view is, through the keys, ending on the last value
 * each field reaches. A last key before `at: 1` holds to the end.
 *
 * @param view - The view handle the hook was given.
 * @param lane - The lane.
 * @param keys - The keys of the track.
 * @param ms - The length of the whole track.
 * @returns The motion, or `undefined` when no key names the lane.
 */
function exitLane(
  view: ViewHandle<unknown>,
  lane: Lane,
  keys: readonly MotionKeyframe[],
  ms: number
): Motion {
  const segments = segmentsOf(lane, keys);
  const target = lastValues(segments);

  if (Object.keys(target).length === 0) return undefined;

  return view.tween(lane.component, target, { ms, ease: KEY_EASE, segments });
}

/**
 * Plays one keyframe track on a view, one segment walk per component the keys name.
 *
 * @param view - The view handle the hook was given.
 * @param keys - The checked keys of the track.
 * @param ms - The length of the whole track: `transition.ms`.
 * @param direction - `"enter"` walks first key → rest, `"exit"` walks rest → last key.
 * @returns One motion over every lane.
 */
export function playKeyframes(
  view: ViewHandle<unknown>,
  keys: readonly MotionKeyframe[],
  ms: number,
  direction: "enter" | "exit"
): Motion {
  const walk = direction === "enter" ? enterLane : exitLane;

  return view.all(lanesOf(view).map(lane => walk(view, lane, keys, ms)));
}
