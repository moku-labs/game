/**
 * @file anim plugin — the keyframe tracks of `defineMotion`: the definition-time checks of a track
 * and of a loop, the enter and exit walks and the loop. One tween with segments per component the
 * keys name, composed with `view.all`, so the whole walk runs on one clock of the driver `world`
 * hands the tween to. Pure, no ctx.
 */
import type { TransformValue } from "../renderer/components";
import { NineSlice, Shape, Sprite, Transform } from "../renderer/components";
import type { AnyComponent } from "../world/ecs/types";
import type {
  ComponentType,
  Ease,
  Motion,
  MotionHandle,
  TrackSegment,
  ViewHandle
} from "../world/types";
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
 * Every field one key names, flat: `"Transform.dx"`, `"Shape.alpha"` and so on.
 *
 * @param key - The key.
 * @returns The named values, keyed by component and field.
 * @example
 * ```ts
 * flatPose({ at: 0, Transform: { rotation: 0.1 }, Shape: { alpha: 1 } }); // { "Transform.rotation": 0.1, "Shape.alpha": 1 }
 * ```
 */
function flatPose(key: MotionKeyframe): Record<string, number> {
  const pose: Record<string, number> = {};

  for (const [field, value] of Object.entries(key.Transform ?? {})) {
    if (value !== undefined) pose[`Transform.${field}`] = value;
  }

  for (const name of ["Shape", "Sprite", "NineSlice"] as const) {
    const alpha = key[name]?.alpha;

    if (alpha !== undefined) pose[`${name}.alpha`] = alpha;
  }

  return pose;
}

/** One whole turn, in radians. */
const TURN = 2 * Math.PI;

/** How far a rotation seam may miss a whole number of turns, in radians. */
const TURN_TOLERANCE = 1e-9;

/**
 * Tells whether a loop field closes on itself: the end equals the start, or, for the rotation,
 * differs from it by whole turns, so the restart at the start looks the same.
 *
 * @param field - The flat field name.
 * @param start - Where the field stands at the first key, `undefined` when no start is known.
 * @param end - Where it stands at the last key.
 * @returns True when the cycle closes without a jump.
 * @example
 * ```ts
 * closesOnItself("Transform.rotation", 0, 2 * Math.PI); // true
 * closesOnItself("Transform.rotation", 0, Math.PI); // false
 * ```
 */
function closesOnItself(field: string, start: number | undefined, end: number): boolean {
  if (start === end) return true;
  if (start === undefined || field !== "Transform.rotation") return false;

  const turns = (end - start) / TURN;

  return Math.abs(end - start - Math.round(turns) * TURN) <= TURN_TOLERANCE;
}

/**
 * Checks the seam of a loop at definition time: every field the track names stands at its last
 * key where it stood at its first key, so a cycle closes without a jump. The rotation may end
 * whole turns away from its start, which is how a blade spins. A Transform field the first key
 * leaves out starts at no offset; an alpha the first key leaves out has no start a definition can
 * know, so a loop that names it later is refused.
 *
 * @param name - The track name, for the error.
 * @param keys - The keys of the track, already checked by `checkTrack`.
 * @throws {Error} When a field ends somewhere else than it starts.
 */
export function checkLoop(name: string, keys: readonly MotionKeyframe[]): void {
  const first = flatPose(keys[0] ?? { at: 0 });
  const held: Record<string, number> = {};

  for (const key of keys) Object.assign(held, flatPose(key));

  for (const [field, value] of Object.entries(held)) {
    const start = first[field] ?? (field.startsWith("Transform.") ? 0 : undefined);

    if (!closesOnItself(field, start, value)) {
      throw new Error(
        `[game] Motion loop "${name}" ends somewhere else than it starts.\n  Give its last key the pose of its first key.`
      );
    }
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
 * The offsets one loop key gives the Transform: every field is added to the rest pose.
 *
 * @param key - The key.
 * @returns The offsets the key names.
 * @example
 * ```ts
 * loopTransformPose({ at: 0.5, Transform: { dx: 4, scale: 0.05 } }); // { x: 4, scale: 0.05 }
 * ```
 */
function loopTransformPose(key: MotionKeyframe): KeyPose {
  const pose: KeyPose = {};
  const fields = key.Transform;

  if (fields?.dx !== undefined) pose.x = fields.dx;
  if (fields?.dy !== undefined) pose.y = fields.dy;
  if (fields?.rotation !== undefined) pose.rotation = fields.rotation;
  if (fields?.scale !== undefined) pose.scale = fields.scale;

  return pose;
}

/**
 * Turns an absolute pose into the offsets from the rest pose, for the alpha of a loop.
 *
 * @param pose - The absolute values a key gives.
 * @param rest - The rest values of the lane.
 * @returns The offsets.
 * @example
 * ```ts
 * offsetsFromRest({ alpha: 0.5 }, { alpha: 1 }); // { alpha: -0.5 }
 * ```
 */
function offsetsFromRest(pose: KeyPose, rest: KeyPose): KeyPose {
  const offsets: KeyPose = {};

  for (const [field, value] of Object.entries(pose)) offsets[field] = value - (rest[field] ?? 0);

  return offsets;
}

/**
 * The lanes of a loop: the lanes of the view, each reading a key as the offsets it adds.
 *
 * @param view - The view handle the hook was given.
 * @returns The lanes, Transform first.
 */
function loopLanesOf(view: ViewHandle<unknown>): Lane[] {
  return lanesOf(view).map(lane => ({
    ...lane,
    pose:
      lane.component.componentName === Transform.componentName
        ? loopTransformPose
        : (key: MotionKeyframe): KeyPose => offsetsFromRest(lane.pose(key), lane.rest)
  }));
}

/**
 * Starts the loop of one lane: an additive walk of offsets, repeated forever. A first key after
 * `at: 0` is held from 0, so the cycle closes on the pose it opens with.
 *
 * @param view - The view handle the hook was given.
 * @param lane - The lane.
 * @param keys - The checked keys of the loop.
 * @param ms - The length of one cycle.
 * @returns The handle of the walk, or `undefined` when the lane moves nothing.
 */
function loopLane(
  view: ViewHandle<unknown>,
  lane: Lane,
  keys: readonly MotionKeyframe[],
  ms: number
): MotionHandle | undefined {
  const segments = segmentsOf(lane, keys);
  const target = lastValues(segments);
  const first = segments[0];

  if (first === undefined || Object.keys(target).length === 0) return undefined;
  if (first.at > 0) segments.unshift({ at: 0, to: first.to });

  return view.tween(lane.component, target, {
    ms,
    ease: KEY_EASE,
    additive: true,
    repeat: "forever",
    segments
  });
}

/**
 * Starts a loop on a view: one additive walk per component the keys name, repeated forever. The
 * walks run until the view dies, `flushAll`, `finishAll`, or the returned motion is cancelled,
 * which is how `ui` swaps the loop of an element whose motion changed.
 *
 * @param view - The view handle the hook was given.
 * @param keys - The checked keys of the loop.
 * @param ms - The length of one cycle: `loop.ms`, or `transition.ms` when it is left out.
 * @returns One motion over every walk; it never ends on its own.
 */
export function playLoop(
  view: ViewHandle<unknown>,
  keys: readonly MotionKeyframe[],
  ms: number
): Motion {
  const walks: MotionHandle[] = [];

  for (const lane of loopLanesOf(view)) {
    const walk = loopLane(view, lane, keys, ms);

    if (walk !== undefined) walks.push(walk);
  }

  return view.all(walks);
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
