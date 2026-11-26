/**
 * @file renderer/sync — the return of the HUD parts an overlay hid (F240, `Overlay.hudReturn`): the record's clamped
 * copy of the value, the runs that count the game time of the render phase from the overlay's first exit frame and
 * outlive its record, the factor a run gives a part on its curve, and the pose its walk draws the part at (F245). Runs
 * are pooled and walked by index: a frame with no run reads one length, a frame with runs allocates nothing; the curves
 * and the keys are read once, when the value changes.
 */
import { cubicBezier } from "../../anim/tween/bezier";
import { EASE_NAMES, easeCell } from "../../world/projection/easing";
import type { Entity } from "../../world/types";
import type { HudEase, HudReturn, HudReturnKey } from "../components";
import type {
  ClampedCurve,
  ClampedHudReturn,
  ClampedKeys,
  ClampedReturnPart,
  EndsWalk,
  HudReturnReport,
  HudReturnRun,
  OverlayRecord,
  OverlayState,
  SyncCtx
} from "./types";

/** What a run holds while it waits in the pool: no overlay's value, so the last one is let go. Frozen: never written. */
const NO_RETURN: ClampedHudReturn = Object.freeze({
  delayMs: 0,
  fadeMs: 0,
  curve: undefined,
  keys: undefined,
  parts: undefined,
  badEase: false,
  badKeys: false,
  badEasePart: undefined,
  badKeysPart: undefined
});

/** The curve a `ease` that cannot be read is drawn on. Frozen: shared by every copy. */
const LINEAR: ClampedCurve = Object.freeze({ name: "linear" });

/** The fields of a walk's pose, in the order of a pose and of a key after its `at`. */
const POSE_FIELDS = ["dx", "dy", "rotation", "scale", "scaleX", "scaleY"] as const;

/** How many numbers one key takes in `ClampedKeys.data`: its `at`, then the six fields of a pose. */
const KEY_STRIDE = 1 + POSE_FIELDS.length;

/**
 * The rest pose of a HUD part: no offset, no turn, its own size. Read by every reset to rest; never written.
 */
export const HUD_REST: Readonly<Float64Array> = Float64Array.of(0, 0, 0, 1, 1, 1);

/** The cell a factor or a segment's time is eased in: a number eased in place is not boxed. */
const CELL = new Float64Array(1);

/** The share of the fade a walk is sampled at, handed over in a cell. */
const SHARE = new Float64Array(1);

/** The pose of one run, sampled before it joins the part's pose: written in place, one run at a time. */
const SAMPLE = new Float64Array(POSE_FIELDS.length);

/** The two poses a segment of a walk goes between: the key it starts on, and the key or the rest it goes to. */
const FROM = new Float64Array(POSE_FIELDS.length);
const TO = new Float64Array(POSE_FIELDS.length);

/** What `clampedReturn` refused while it read a value: the first curve and the first keys that cannot be read. */
type Refusals = {
  badEase: boolean;
  badKeys: boolean;
  badEasePart: string | undefined;
  badKeysPart: string | undefined;
};

/**
 * Tells whether a value is a time of `hudReturn`: a finite number. Pure.
 *
 * @param value - The field as the marker carries it.
 * @returns True for a finite number.
 * @example
 * ```ts
 * isTime(Number.NaN); // false
 * ```
 */
function isTime(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Tells whether a value is a plain object, not a list: its fields can then be read, each still to be checked. The
 * stored value is a real boundary (a game's JSON, an older build), so its fields are `unknown` until checked. Pure.
 *
 * @param value - The value.
 * @returns True for an object that is no array and not `null`.
 * @example
 * ```ts
 * isObject(["gems"]); // false
 * ```
 */
function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Tells whether a value of `parts` is an override: an object whose `delayMs` and `fadeMs`, each when given, are finite.
 * Pure.
 *
 * @param value - The value of one key.
 * @returns True when it can be read.
 * @example
 * ```ts
 * isOverride({ delayMs: 1250 }); // true
 * ```
 */
function isOverride(value: unknown): boolean {
  if (!isObject(value)) return false;

  const { delayMs, fadeMs } = value;

  return (delayMs === undefined || isTime(delayMs)) && (fadeMs === undefined || isTime(fadeMs));
}

/**
 * Tells whether a stored `hudReturn` can be read: an object with a finite `delayMs` and `fadeMs`, and with `parts`, an
 * object of overrides. A value stored by a game's JSON or an older build is checked here once, when it changes. Pure.
 *
 * @param value - The field as the marker carries it.
 * @returns True when it is a `HudReturn`.
 * @example
 * ```ts
 * isHudReturn({ delayMs: 1100 }); // false
 * ```
 */
function isHudReturn(value: unknown): value is HudReturn {
  if (!isObject(value)) return false;

  const { delayMs, fadeMs, parts } = value;

  if (!isTime(delayMs) || !isTime(fadeMs)) return false;
  if (parts === undefined) return true;

  return isObject(parts) && Object.values(parts).every(part => isOverride(part));
}

/**
 * Tells whether a value is a list. Pure.
 *
 * @param value - The value.
 * @returns True for an array, its items still to be checked.
 * @example
 * ```ts
 * isList({ at: 0 }); // false
 * ```
 */
function isList(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

/**
 * Tells whether a number lies in 0..1. Pure.
 *
 * @param value - The number.
 * @returns True from 0 to 1, both included.
 * @example
 * ```ts
 * inUnit(1.2); // false
 * ```
 */
function inUnit(value: unknown): boolean {
  return isTime(value) && value >= 0 && value <= 1;
}

/**
 * Tells whether a value is a curve of a `hudReturn` (F245): a named curve of `world`, or four finite numbers with x1
 * and x2 in 0..1. A function, a number or any other value is none. Pure.
 *
 * @param value - The `ease` as stored.
 * @returns True for a `HudEase`.
 * @example
 * ```ts
 * isHudEase([1.2, 0, 0.3, 1]); // false
 * ```
 */
function isHudEase(value: unknown): value is HudEase {
  if (typeof value === "string") return (EASE_NAMES as readonly string[]).includes(value);
  if (!isList(value) || value.length !== 4 || !value.every(item => isTime(item))) return false;

  return inUnit(value[0]) && inUnit(value[2]);
}

/**
 * The curve a `HudEase` is drawn on: a name kept to be eased in a cell, a tuple solved into its table once. Pure.
 *
 * @param ease - The curve.
 * @returns Its clamped curve.
 * @example
 * ```ts
 * curveOf("outCubic"); // { name: "outCubic" }
 * ```
 */
function curveOf(ease: HudEase): ClampedCurve {
  if (typeof ease === "string") return { name: ease };

  const [x1, y1, x2, y2] = ease;

  return { bezier: cubicBezier(x1, y1, x2, y2), points: [x1, y1, x2, y2] };
}

/**
 * Notes the first curve that cannot be read, and the key of `parts` it is in.
 *
 * @param refusals - What the copy refused so far.
 * @param part - The key of `parts`, `undefined` for the overlay's own.
 */
function refuseEase(refusals: Refusals, part: string | undefined): void {
  if (refusals.badEase) return;

  refusals.badEase = true;
  refusals.badEasePart = part;
}

/**
 * Notes the first keys that cannot be read, and the key of `parts` they are in.
 *
 * @param refusals - What the copy refused so far.
 * @param part - The key of `parts`, `undefined` for the overlay's own.
 */
function refuseKeys(refusals: Refusals, part: string | undefined): void {
  if (refusals.badKeys) return;

  refusals.badKeys = true;
  refusals.badKeysPart = part;
}

/**
 * Reads one `ease` of a value: the one inherited when none is given, linear and noted when it cannot be read.
 *
 * @param ease - The `ease` as stored.
 * @param inherited - The curve taken without one.
 * @param refusals - What the copy refused so far.
 * @param part - The key of `parts` it is in, `undefined` for the overlay's own.
 * @returns The curve.
 */
function readCurve(
  ease: unknown,
  inherited: ClampedCurve,
  refusals: Refusals,
  part: string | undefined
): ClampedCurve {
  if (ease === undefined) return inherited;
  if (isHudEase(ease)) return curveOf(ease);

  refuseEase(refusals, part);

  return LINEAR;
}

/**
 * Tells whether a value is a key of a walk: an object with an `at` in 0..1 and, when given, a `Transform` object whose
 * six fields are each finite when given. Its `ease` is read apart: a bad curve leaves the key. Pure.
 *
 * @param value - One key as stored.
 * @returns True when it can be walked.
 * @example
 * ```ts
 * isKey({ at: 0, Transform: { dy: Number.NaN } }); // false
 * ```
 */
function isKey(value: unknown): value is HudReturnKey {
  if (!isObject(value) || !inUnit(value.at)) return false;

  const pose = value.Transform;

  if (pose === undefined) return true;
  if (!isObject(pose)) return false;

  return POSE_FIELDS.every(field => pose[field] === undefined || isTime(pose[field]));
}

/**
 * Tells whether a value is the keys of a walk: a list of one key or more, their `at` strictly ascending. Pure.
 *
 * @param value - The `keyframes` as stored.
 * @returns True when they can be walked.
 * @example
 * ```ts
 * isKeyList([{ at: 0.5 }, { at: 0.25 }]); // false
 * ```
 */
function isKeyList(value: unknown): value is readonly HudReturnKey[] {
  if (!isList(value) || value.length === 0) return false;

  let previous = Number.NEGATIVE_INFINITY;

  for (const key of value) {
    if (!isKey(key) || key.at <= previous) return false;

    previous = key.at;
  }

  return true;
}

/**
 * Flattens readable keys into the copy's numbers: `at` and the six fields of each key, NaN for a field it does not
 * name, and the curve of the segment that ends on it (`undefined`: the return's).
 *
 * @param list - The keys, checked.
 * @param refusals - What the copy refused so far: a key's curve that cannot be read is linear and noted.
 * @param part - The key of `parts` they are in, `undefined` for the overlay's own.
 * @returns The flattened keys.
 */
function flatKeys(
  list: readonly HudReturnKey[],
  refusals: Refusals,
  part: string | undefined
): ClampedKeys {
  const data = new Float64Array(list.length * KEY_STRIDE);
  const curves: ClampedCurve[] = [];

  for (const [index, key] of list.entries()) {
    const at = index * KEY_STRIDE;

    data[at] = key.at;
    for (const [field, name] of POSE_FIELDS.entries()) {
      data[at + 1 + field] = key.Transform?.[name] ?? Number.NaN;
    }
    curves.push(readCurve(key.ease, undefined, refusals, part));
  }

  return { count: list.length, data, curves };
}

/**
 * Reads one `keyframes` of a value: the keys inherited when none are given, no walk and noted when they cannot be read.
 *
 * @param keyframes - The `keyframes` as stored.
 * @param inherited - The keys taken without any.
 * @param refusals - What the copy refused so far.
 * @param part - The key of `parts` they are in, `undefined` for the overlay's own.
 * @returns The keys, or `undefined` for no walk.
 */
function readKeys(
  keyframes: unknown,
  inherited: ClampedKeys | undefined,
  refusals: Refusals,
  part: string | undefined
): ClampedKeys | undefined {
  if (keyframes === undefined) return inherited;
  if (isKeyList(keyframes)) return flatKeys(keyframes, refusals, part);

  refuseKeys(refusals, part);

  return undefined;
}

/**
 * The record's own copy of a stored `hudReturn`: every time 0 or more, its curve resolved (a tuple solved once) and its
 * keys flattened (F245), each key of `parts` with its times, curve and keys filled in from the overlay's when not given.
 * A curve that cannot be read is linear, keys that cannot be read walk nothing; both are noted in the copy for the
 * warnings. Made only when the marker carries a new value. Pure.
 *
 * @param value - The field as the marker carries it.
 * @returns The copy, or `undefined` for no value and for one whose times cannot be read.
 * @example
 * ```ts
 * clampedReturn({ delayMs: -50, fadeMs: 400, ease: "bounce", parts: { gems: { delayMs: 1250 } } });
 * // { delayMs: 0, fadeMs: 400, curve: { name: "linear" }, keys: undefined,
 * //   parts: Map { "gems" => { delayMs: 1250, fadeMs: 400, curve: { name: "linear" }, keys: undefined } },
 * //   badEase: true, badKeys: false, badEasePart: undefined, badKeysPart: undefined }
 * ```
 */
export function clampedReturn(value: unknown): ClampedHudReturn | undefined {
  if (!isHudReturn(value)) return undefined;

  const delayMs = Math.max(0, value.delayMs);
  const fadeMs = Math.max(0, value.fadeMs);
  const refusals: Refusals = {
    badEase: false,
    badKeys: false,
    badEasePart: undefined,
    badKeysPart: undefined
  };
  const curve = readCurve(value.ease, undefined, refusals, undefined);
  const keys = readKeys(value.keyframes, undefined, refusals, undefined);

  if (value.parts === undefined) return { delayMs, fadeMs, curve, keys, parts: undefined, ...refusals };

  const parts = new Map<string, ClampedReturnPart>();

  for (const [key, part] of Object.entries(value.parts)) {
    // Only narrows the type: `isHudReturn` refused a value with a key that holds no override.
    if (part === undefined) continue;

    parts.set(key, {
      delayMs: Math.max(0, part.delayMs ?? delayMs),
      fadeMs: Math.max(0, part.fadeMs ?? fadeMs),
      curve: readCurve(part.ease, curve, refusals, key),
      keys: readKeys(part.keyframes, keys, refusals, key)
    });
  }

  return { delayMs, fadeMs, curve, keys, parts, ...refusals };
}

/**
 * Tells whether two curves as stored are the same: a name or any other value by `Object.is`, a list by its items.
 * Pure.
 *
 * @param next - The `ease` written now.
 * @param previous - The `ease` the copy was made from.
 * @returns True when they are the same.
 * @example
 * ```ts
 * sameEase([0.25, 0.6, 0.3, 1], [0.25, 0.6, 0.3, 1]); // true
 * ```
 */
function sameEase(next: unknown, previous: unknown): boolean {
  if (!isList(next) || !isList(previous)) return Object.is(next, previous);
  if (next.length !== previous.length) return false;

  // eslint-disable-next-line unicorn/no-for-loop -- the indexed walk allocates nothing.
  for (let index = 0; index < next.length; index += 1) {
    if (!Object.is(next[index], previous[index])) return false;
  }

  return true;
}

/**
 * Tells whether two `Transform` fields of a key as stored are the same: the six fields of a pose. Pure.
 *
 * @param next - The field written now.
 * @param previous - The field the copy was made from.
 * @returns True when they are the same.
 * @example
 * ```ts
 * samePose({ dy: -8 }, { dy: -12 }); // false
 * ```
 */
function samePose(next: unknown, previous: unknown): boolean {
  if (!isObject(next) || !isObject(previous)) return Object.is(next, previous);

  // Each field compared at its own `===`, whose type feedback keeps a fraction unboxed: `Object.is` takes no feedback
  // and boxed a fraction read from keys of several shapes (measured, 16 B a field). NaN is the same as NaN.
  return (
    (next.dx === previous.dx || bothNaN(next.dx, previous.dx)) &&
    (next.dy === previous.dy || bothNaN(next.dy, previous.dy)) &&
    (next.rotation === previous.rotation || bothNaN(next.rotation, previous.rotation)) &&
    (next.scale === previous.scale || bothNaN(next.scale, previous.scale)) &&
    (next.scaleX === previous.scaleX || bothNaN(next.scaleX, previous.scaleX)) &&
    (next.scaleY === previous.scaleY || bothNaN(next.scaleY, previous.scaleY))
  );
}

/**
 * Tells whether two values that are not `===` are both NaN, so a stored NaN keeps its copy as `Object.is` would. Pure.
 *
 * @param next - The value written now.
 * @param previous - The value the copy was made from.
 * @returns True when both are NaN.
 * @example
 * ```ts
 * bothNaN(Number.NaN, Number.NaN); // true
 * ```
 */
function bothNaN(next: unknown, previous: unknown): boolean {
  return Number.isNaN(next) && Number.isNaN(previous);
}

/**
 * Tells whether two `keyframes` as stored are the same: as many keys, each with the same `at`, `ease` and pose. Pure.
 *
 * @param next - The keys written now.
 * @param previous - The keys the copy was made from.
 * @returns True when they are the same.
 * @example
 * ```ts
 * sameKeys([{ at: 0, Transform: { dy: -8 } }], [{ at: 0, Transform: { dy: -8 } }]); // true
 * ```
 */
function sameKeys(next: unknown, previous: unknown): boolean {
  if (!isList(next) || !isList(previous)) return Object.is(next, previous);
  if (next.length !== previous.length) return false;

  // eslint-disable-next-line unicorn/no-for-loop -- the indexed walk allocates nothing.
  for (let index = 0; index < next.length; index += 1) {
    const key = next[index];
    const before = previous[index];

    if (!isObject(key) || !isObject(before)) {
      if (!Object.is(key, before)) return false;

      continue;
    }

    // `===` for the `at`, as in `samePose`: a fractional `at` among keys of several shapes stays unboxed.
    const isSame =
      (key.at === before.at || bothNaN(key.at, before.at)) &&
      sameEase(key.ease, before.ease) &&
      samePose(key.Transform, before.Transform);

    if (!isSame) return false;
  }

  return true;
}

/**
 * Tells whether two values carry the same `delayMs`, `fadeMs`, `ease` and `keyframes`: each read as stored, so two
 * equal malformed values are the same too; two values that are no objects are the same only when they are one. Pure.
 *
 * @param next - The value written now.
 * @param previous - The value the copy was made from.
 * @returns True when the four fields are the same.
 * @example
 * ```ts
 * sameOwn({ delayMs: 1250, ease: "out" }, { delayMs: 1250, ease: "out" }); // true
 * ```
 */
function sameOwn(next: unknown, previous: unknown): boolean {
  if (!isObject(next) || !isObject(previous)) return Object.is(next, previous);

  return (
    Object.is(next.delayMs, previous.delayMs) &&
    Object.is(next.fadeMs, previous.fadeMs) &&
    sameEase(next.ease, previous.ease) &&
    sameKeys(next.keyframes, previous.keyframes)
  );
}

/**
 * Tells whether a `hudReturn` written now says what the one its copy was made from said: the same times, curve and
 * keys, the same keys of `parts` with the same of each. An inline literal a render writes again is a new object with
 * the same content, and keeps the copy. Walks the keys with `for…in` and the lists by index, so no list is made. Pure.
 *
 * @param next - The value written now.
 * @param previous - The value the copy was made from.
 * @returns True when the copy still holds.
 * @example
 * ```ts
 * sameReturn({ delayMs: 1100, fadeMs: 700, parts: { gems: {} } }, { delayMs: 1100, fadeMs: 700, parts: { gems: {} } }); // true
 * ```
 */
export function sameReturn(next: unknown, previous: unknown): boolean {
  if (!isObject(next) || !isObject(previous)) return Object.is(next, previous);
  if (!sameOwn(next, previous)) return false;

  const nextParts = next.parts;
  const previousParts = previous.parts;

  if (!isObject(nextParts) || !isObject(previousParts)) return Object.is(nextParts, previousParts);

  // Every written key stored before with the same times, then no stored key left out. A plain object: every key
  // `for…in` walks is its own.
  for (const key in nextParts) {
    if (!Object.hasOwn(previousParts, key) || !sameOwn(nextParts[key], previousParts[key])) {
      return false;
    }
  }

  for (const key in previousParts) {
    if (!Object.hasOwn(nextParts, key)) return false;
  }

  return true;
}

/**
 * Tells whether a run holds a key: every key with `"none"`, the keys not listed with a list. Pure.
 *
 * @param hud - The `hud` taken at the leave.
 * @param key - The part's key.
 * @returns True when the part waits for this run.
 * @example
 * ```ts
 * holds(["stars"], "stars"); // false
 * ```
 */
function holds(hud: "none" | readonly string[], key: string): boolean {
  return hud === "none" || !hud.includes(key);
}

/**
 * Takes one key of `parts` into the walk of `endsOf`: its end when the run holds it. Called by `Map.forEach` with the
 * state's scratch as `this`, so the walk makes no closure and keeps nothing outside the state.
 *
 * @param this - The walk's scratch, `OverlayState.endsWalk`.
 * @param part - The key's clamped times.
 * @param key - The key.
 */
function endOfPart(this: EndsWalk, part: ClampedReturnPart, key: string): void {
  if (!holds(this.hud, key)) return;

  this.ends = Math.max(this.ends, part.delayMs + (this.reduced ? 0 : part.fadeMs));
}

/**
 * The game time a run ends at: the last delay plus fade over the keys it holds, the overlay's own included (every key
 * `parts` does not list takes it); under reduced motion, the last delay. Walked once, when the run starts, with
 * `forEach`, a callback of the module and the state's scratch as its `this`: a `for…of` over the Map makes an iterator
 * and an entry per key.
 *
 * @param walk - The scratch of the walk, `OverlayState.endsWalk`.
 * @param value - The clamped value.
 * @param hud - The `hud` taken at the leave.
 * @param reduced - Reduced motion was on at the leave.
 * @returns Milliseconds of game time from the leave.
 */
export function endsOf(
  walk: EndsWalk,
  value: ClampedHudReturn,
  hud: "none" | readonly string[],
  reduced: boolean
): number {
  const ends = value.delayMs + (reduced ? 0 : value.fadeMs);

  if (value.parts === undefined) return ends;

  walk.hud = hud;
  walk.reduced = reduced;
  walk.ends = ends;
  // A Map, not an array: `forEach` makes no iterator, and its `this` argument carries the state's scratch, no closure.
  // eslint-disable-next-line unicorn/no-array-for-each, unicorn/no-array-callback-reference, unicorn/no-array-method-this-argument -- see above.
  value.parts.forEach(endOfPart, walk);
  // The walk lets the overlay's key list go.
  walk.hud = "none";

  return walk.ends;
}

/**
 * Eases the time in one cell, in place, on a clamped curve: a name through `easeCell`, a tuple through its solved table;
 * linear leaves it. Takes no number and returns none, so a frame boxes no double.
 *
 * @param curve - The curve, `undefined` for linear.
 * @param cells - The cells.
 * @param at - The index of the cell that holds the time and receives the eased fraction.
 */
function easeInto(curve: ClampedCurve, cells: Float64Array, at: number): void {
  if (curve === undefined) return;

  // A tuple's table as the function ease of `easeCell`: the way a tween of `anim` eases on a `cubicBezier`, unboxed.
  easeCell("name" in curve ? curve.name : curve.bezier, cells, at);
}

/**
 * Writes the factor of a return at a moment into `CELL[0]`: 0 before the delay, the curve over the fade (linear without
 * one) kept within 0..1, 1 after it; a fade of 0 jumps to 1 at the delay. A fraction never leaves it as a returned
 * number: a call V8 does not inline boxes one, and the step of the HUD parts inlines less as it grows (measured).
 *
 * @param elapsed - Game time since the leave started, ms.
 * @param delay - The part's delay, ms.
 * @param fade - The part's fade, ms.
 * @param curve - The part's curve; linear when `undefined`.
 */
function factorInCell(elapsed: number, delay: number, fade: number, curve: ClampedCurve): void {
  if (elapsed < delay) {
    CELL[0] = 0;

    return;
  }

  if (fade <= 0) {
    CELL[0] = 1;

    return;
  }

  CELL[0] = Math.min(1, (elapsed - delay) / fade);
  if (curve === undefined) return;

  easeInto(curve, CELL, 0);
  // An overshooting curve leaves 0..1 (`inBack`, `outBack`): the factor is an alpha.
  CELL[0] = Math.min(1, Math.max(0, CELL[0] ?? 0));
}

/**
 * The factor of a return at a moment: 0 before the delay, the curve over the fade (linear without one) kept within 0..1,
 * 1 after it; a fade of 0 jumps to 1 at the delay. Pure.
 *
 * @param elapsed - Game time since the leave started, ms.
 * @param delay - The part's delay, ms.
 * @param fade - The part's fade, ms.
 * @param curve - The part's curve (F245); linear when left out.
 * @returns The factor, 0 to 1.
 * @example
 * ```ts
 * returnFactor(1450, 1100, 700); // 0.5
 * ```
 */
export function returnFactor(
  elapsed: number,
  delay: number,
  fade: number,
  curve?: ClampedCurve
): number {
  factorInCell(elapsed, delay, fade, curve);

  return CELL[0] ?? 0;
}

/**
 * Multiplies the factor in `cells[0]` by the one a run gives a part: nothing for a key it does not hold, else its
 * return at the run's game time, the key's own times and curve read from the clamped copy.
 *
 * @param run - The run.
 * @param key - The part's key.
 * @param cells - The cell of the product, written in place.
 */
function factorOfRun(run: HudReturnRun, key: string, cells: Float64Array): void {
  if (!holds(run.hud, key)) return;

  const { value } = run;
  const part = value.parts?.get(key);
  const delay = part === undefined ? value.delayMs : part.delayMs;
  const fade = part === undefined ? value.fadeMs : part.fadeMs;
  const curve = part === undefined ? value.curve : part.curve;

  factorInCell(run.elapsed, delay, run.reduced ? 0 : fade, curve);
  cells[0] = (cells[0] ?? 1) * (CELL[0] ?? 0);
}

/**
 * Puts a pose at rest: no offset, no turn, its own size.
 *
 * @param pose - The six numbers of a pose, written in place.
 */
export function restPose(pose: Float64Array): void {
  pose[0] = 0;
  pose[1] = 0;
  pose[2] = 0;
  pose[3] = 1;
  pose[4] = 1;
  pose[5] = 1;
}

/**
 * Writes the pose one key stands at into a pose: each field the key's own, else the last key before it that names the
 * field, else rest. Numbers stay in the arrays: no field is returned, so none is boxed.
 *
 * @param data - The flattened keys.
 * @param index - The key.
 * @param into - The pose.
 */
function poseAtKey(data: Float64Array, index: number, into: Float64Array): void {
  for (let field = 0; field < POSE_FIELDS.length; field += 1) {
    into[field] = HUD_REST[field] ?? 0;

    for (let key = index; key >= 0; key -= 1) {
      const named = data[key * KEY_STRIDE + 1 + field] ?? Number.NaN;

      if (!Number.isNaN(named)) {
        into[field] = named;
        break;
      }
    }
  }
}

/**
 * Samples a walk at the share of its fade in `SHARE[0]` into a pose, as an enter of `defineMotion` walks its keys
 * (F245): on the first key up to its `at`, between two keys on the curve of the key it goes to (the return's without
 * one), from the last key to rest at 1 on the curve of a key at `at: 1` (whose fields are no pose) or the return's, at
 * rest from 1 on. A lone key at `at: 1` is the pose the walk starts from. A curve that overshoots carries the pose past
 * its keys. The share comes in a cell and the poses go through `FROM` and `TO`: no number crosses a call.
 *
 * @param keys - The flattened keys.
 * @param curve - The return's curve, `undefined` for linear.
 * @param into - The pose, written in place.
 */
function walkInto(keys: ClampedKeys, curve: ClampedCurve, into: Float64Array): void {
  const share = SHARE[0] ?? 0;

  if (share >= 1) {
    restPose(into);

    return;
  }

  const { count, data, curves } = keys;
  const last = count - 1;
  const endsOnKey = data[last * KEY_STRIDE] === 1;
  // A last key at 1 only gives the last segment its curve; a lone one still stands where the walk starts.
  const poses = endsOnKey && count > 1 ? last : count;
  const firstAt = endsOnKey && count === 1 ? 0 : (data[0] ?? 0);

  if (share <= firstAt) {
    poseAtKey(data, 0, into);

    return;
  }

  let from = 0;

  while (from + 1 < poses && share >= (data[(from + 1) * KEY_STRIDE] ?? 1)) from += 1;

  const isLast = from + 1 >= poses;
  const start = from === 0 ? firstAt : (data[from * KEY_STRIDE] ?? 0);
  const end = isLast ? 1 : (data[(from + 1) * KEY_STRIDE] ?? 1);
  const segmentCurve = isLast
    ? ((endsOnKey ? curves[last] : undefined) ?? curve)
    : (curves[from + 1] ?? curve);

  CELL[0] = (share - start) / (end - start);
  easeInto(segmentCurve, CELL, 0);
  poseAtKey(data, from, FROM);
  if (isLast) restPose(TO);
  else poseAtKey(data, from + 1, TO);

  const eased = CELL[0] ?? 0;

  for (let field = 0; field < POSE_FIELDS.length; field += 1) {
    const value = FROM[field] ?? 0;

    into[field] = value + ((TO[field] ?? 0) - value) * eased;
  }
}

/**
 * Samples a walk at a share of its fade into a pose: `walkInto` with the share handed over as a number. For a caller
 * outside the frame; the step hands the share in a cell.
 *
 * @param keys - The flattened keys.
 * @param curve - The return's curve, `undefined` for linear.
 * @param share - The share of the fade, `(elapsed - delay) / fade`.
 * @param into - The pose, written in place.
 */
export function samplePose(
  keys: ClampedKeys,
  curve: ClampedCurve,
  share: number,
  into: Float64Array
): void {
  SHARE[0] = share;
  walkInto(keys, curve, into);
}

/**
 * Adds the pose of one run to a part's pose: nothing for a key it does not hold, for a part with no walk, or once its
 * walk is over; else its walk sampled at the run's game time, on the first key before the delay (reduced motion cuts
 * the walk: rest from the delay on). Offsets add, factors multiply.
 *
 * @param run - The run.
 * @param key - The part's key.
 * @param pose - The part's pose.
 * @returns True while the walk still moves the part.
 */
function poseOfRun(run: HudReturnRun, key: string, pose: Float64Array): boolean {
  if (!holds(run.hud, key)) return false;

  const { value } = run;
  const part = value.parts?.get(key);
  const keys = part === undefined ? value.keys : part.keys;
  const delay = part === undefined ? value.delayMs : part.delayMs;
  const ownFade = part === undefined ? value.fadeMs : part.fadeMs;
  const fade = run.reduced ? 0 : ownFade;

  if (keys === undefined || run.elapsed >= delay + fade) return false;

  // Before the delay the part stands on its first key; `fade` is above 0 past the delay.
  SHARE[0] = run.elapsed < delay ? 0 : (run.elapsed - delay) / fade;
  walkInto(keys, part === undefined ? value.curve : part.curve, SAMPLE);

  for (let field = 0; field < 3; field += 1) pose[field] = (pose[field] ?? 0) + (SAMPLE[field] ?? 0);
  for (let field = 3; field < POSE_FIELDS.length; field += 1) {
    pose[field] = (pose[field] ?? 1) * (SAMPLE[field] ?? 1);
  }

  return true;
}

/**
 * Adds the walks of the returns in progress to a part's pose (F245): every run that holds the key and has keys for it,
 * normally one.
 *
 * @param returns - The runs in progress.
 * @param key - The part's key.
 * @param pose - The part's pose, at rest before the first run.
 * @returns True while a walk still moves the part: it takes no tap.
 */
export function poseOf(returns: readonly HudReturnRun[], key: string, pose: Float64Array): boolean {
  let isWalking = false;

  // per frame and part: the runs walked by index, as `returnOf`.
  // eslint-disable-next-line unicorn/no-for-loop -- the indexed walk allocates nothing.
  for (let index = 0; index < returns.length; index += 1) {
    const run = returns[index];

    if (run !== undefined && poseOfRun(run, key, pose)) isWalking = true;
  }

  return isWalking;
}

/**
 * Multiplies the factor in `cells[0]` by the one the returns in progress give a part: the product over the runs,
 * nothing with none. In a cell, not returned: the step that calls it is too large for V8 to inline every callee, and a
 * fraction returned by one it does not inline is boxed (measured, 16 B a part).
 *
 * @param returns - The runs in progress.
 * @param key - The part's key.
 * @param cells - The cell of the factor, written in place.
 */
export function returnOf(returns: readonly HudReturnRun[], key: string, cells: Float64Array): void {
  // per frame and part: the runs walked by index, normally none or one; `for…of` makes an iterator in the cold tiers.
  // eslint-disable-next-line unicorn/no-for-loop -- the indexed walk allocates nothing.
  for (let index = 0; index < returns.length; index += 1) {
    const run = returns[index];

    if (run !== undefined) factorOfRun(run, key, cells);
  }
}

/**
 * Cuts the runs in progress to their count with `pop`: V8 keeps the array's backing store, where `length = 0` drops it
 * and the next leave's `push` makes a new one (measured).
 *
 * @param returns - The runs in progress.
 * @param count - How many stay.
 */
function cutRuns(returns: HudReturnRun[], count: number): void {
  while (returns.length > count) returns.pop();
}

/**
 * Puts an ended run back in the pool, holding nothing of its overlay.
 *
 * @param overlay - The overlay state.
 * @param run - The run that ended.
 */
function releaseRun(overlay: OverlayState, run: HudReturnRun): void {
  run.value = NO_RETURN;
  run.hud = "none";
  run.label = "";
  overlay.returnPool.push(run);
}

/**
 * Ends the run of one overlay, if it has one: back in the pool, the last run moved into its slot.
 *
 * @param overlay - The overlay state.
 * @param owner - The overlay's entity.
 */
export function endReturnOf(overlay: OverlayState, owner: Entity): void {
  const { returns } = overlay;

  for (let index = 0; index < returns.length; index += 1) {
    const run = returns[index];

    if (run?.owner !== owner) continue;

    releaseRun(overlay, run);
    returns[index] = returns.at(-1) ?? run;
    cutRuns(returns, returns.length - 1);

    return;
  }
}

/**
 * Ends every run, for new layers: the HUD of the new scene waits for none of them.
 *
 * @param overlay - The overlay state.
 */
export function endReturns(overlay: OverlayState): void {
  const { returns } = overlay;

  // eslint-disable-next-line unicorn/no-for-loop -- the indexed walk allocates nothing.
  for (let index = 0; index < returns.length; index += 1) {
    const run = returns[index];

    if (run !== undefined) releaseRun(overlay, run);
  }

  cutRuns(returns, 0);
}

/**
 * Starts the run of an overlay whose leave starts this frame, at 0: its clamped value and its `hud` taken now, its end
 * chosen now, reduced motion read now; an earlier run of the same overlay ends first. `hud: "all"` and `"under"` hid
 * nothing and start none, nor does an overlay without a readable value.
 *
 * @param overlay - The overlay state.
 * @param record - The overlay that leaves.
 * @param reduced - Reduced motion is on.
 */
export function startReturn(overlay: OverlayState, record: OverlayRecord, reduced: boolean): void {
  // What the leave starts from: the record's clamped copy and the parts it hides now.
  const value = record.hudReturn;
  const { hud } = record.value;

  endReturnOf(overlay, record.entity);

  // No readable value, or an overlay that hid nothing: no run.
  if (value === undefined || hud === "all" || hud === "under") return;

  // A run of the pool, made only before the first one ended.
  const run: HudReturnRun = overlay.returnPool.pop() ?? {
    owner: record.entity,
    label: "",
    elapsed: 0,
    value,
    hud,
    reduced,
    endsMs: 0
  };

  // Its fields written for this leave, its end chosen once.
  run.owner = record.entity;
  run.label = record.label;
  run.elapsed = 0;
  run.value = value;
  run.hud = hud;
  run.reduced = reduced;
  run.endsMs = endsOf(overlay.endsWalk, value, hud, reduced);
  overlay.returns.push(run);
}

/**
 * Counts this frame's game time into every run, ends the runs that reached their end (back in the pool, the others
 * written in place and the list cut to their count), and wakes the clock in a frame it marks idle while a run is left
 * and this frame counted game time, so the loop never drops to its idle rate during a delay where nothing else asks for
 * a frame. A paused game (a delta of 0) counts nothing and wakes nothing.
 *
 * @param sctx - Domain context of the sync module.
 */
export function stepReturns(sctx: SyncCtx): void {
  const state = sctx.ctx.state.sync;
  const overlay = state.overlay;
  const { returns } = overlay;
  const delta = state.frameDelta;
  let count = 0;

  // per frame: the runs written in place by index, normally one; no iterator, no new list.
  for (let index = 0; index < returns.length; index += 1) {
    const run = returns[index];

    if (run === undefined) continue;

    run.elapsed += delta;

    if (run.elapsed >= run.endsMs) {
      releaseRun(overlay, run);

      continue;
    }

    // A run still in progress moves down over the ended ones before it.
    if (returns[count] !== run) returns[count] = run;
    count += 1;
  }

  cutRuns(returns, count);
  if (count > 0 && state.frameIdle && delta > 0) sctx.ctx.deps.time.wake();
}

/**
 * The run in progress of one overlay, for its report.
 *
 * @param overlay - The overlay state.
 * @param owner - The overlay's entity.
 * @returns Its run, or `undefined` with none.
 */
export function runOf(overlay: OverlayState, owner: Entity): HudReturnRun | undefined {
  return overlay.returns.find(run => run.owner === owner);
}

/**
 * Every return in progress as `debug.hudReturns()` reports it, in the order the runs started, as a fresh array. A run
 * is read here whether or not its overlay's record is still there. Built only when asked, never per frame.
 *
 * @param sctx - Domain context of the sync module.
 * @returns One report per run; `[]` with none, and while inert.
 */
export function hudReturnReports(sctx: SyncCtx): readonly HudReturnReport[] {
  const state = sctx.ctx.state.sync;

  if (state.root === undefined) return [];

  return state.overlay.returns.map(run => ({
    owner: run.owner,
    label: run.label,
    delayMs: run.value.delayMs,
    fadeMs: run.reduced ? 0 : run.value.fadeMs,
    elapsed: run.elapsed
  }));
}
