/**
 * @file renderer/sync — the return of the HUD parts an overlay hid (F240, `Overlay.hudReturn`): the record's clamped
 * copy of the value, the runs that count the game time of the render phase from the overlay's first exit frame and
 * outlive its record, and the factor a run gives a part. Runs are pooled and walked by index: a frame with no run reads
 * one length, a frame with runs allocates nothing.
 */
import type { Entity } from "../../world/types";
import type { HudReturn } from "../components";
import type {
  ClampedHudReturn,
  ClampedReturnPart,
  HudReturnRun,
  OverlayRecord,
  OverlayState,
  SyncCtx
} from "./types";

/** What a run holds while it waits in the pool: no overlay's value, so the last one is let go. */
const NO_RETURN: ClampedHudReturn = { delayMs: 0, fadeMs: 0, parts: undefined };

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
 * The record's own copy of a stored `hudReturn`: every time 0 or more, each key of `parts` with both of its times
 * filled in from the overlay's. Made only when the marker carries a new value. Pure.
 *
 * @param value - The field as the marker carries it.
 * @returns The copy, or `undefined` for no value and for one that cannot be read.
 * @example
 * ```ts
 * clampedReturn({ delayMs: -50, fadeMs: 400, parts: { gems: { delayMs: 1250 } } });
 * // { delayMs: 0, fadeMs: 400, parts: Map { "gems" => { delayMs: 1250, fadeMs: 400 } } }
 * ```
 */
export function clampedReturn(value: unknown): ClampedHudReturn | undefined {
  if (!isHudReturn(value)) return undefined;

  const delayMs = Math.max(0, value.delayMs);
  const fadeMs = Math.max(0, value.fadeMs);

  if (value.parts === undefined) return { delayMs, fadeMs, parts: undefined };

  const parts = new Map<string, ClampedReturnPart>();

  for (const [key, part] of Object.entries(value.parts)) {
    // Only narrows the type: `isHudReturn` refused a value with a key that holds no override.
    if (part === undefined) continue;

    parts.set(key, {
      delayMs: Math.max(0, part.delayMs ?? delayMs),
      fadeMs: Math.max(0, part.fadeMs ?? fadeMs)
    });
  }

  return { delayMs, fadeMs, parts };
}

/**
 * Tells whether two values carry the same `delayMs` and `fadeMs`: each read as stored, so two equal malformed values are
 * the same too; two values that are no objects are the same only when they are one. Pure.
 *
 * @param next - The value written now.
 * @param previous - The value the copy was made from.
 * @returns True when both times are the same.
 * @example
 * ```ts
 * sameTimes({ delayMs: 1250 }, { delayMs: 1250 }); // true
 * ```
 */
function sameTimes(next: unknown, previous: unknown): boolean {
  if (!isObject(next) || !isObject(previous)) return Object.is(next, previous);

  return Object.is(next.delayMs, previous.delayMs) && Object.is(next.fadeMs, previous.fadeMs);
}

/**
 * Tells whether a `hudReturn` written now says what the one its copy was made from said: the same times, the same keys
 * of `parts` with the same times. An inline literal a render writes again is a new object with the same content, and
 * keeps the copy. Walks the keys with `for…in`, so no list is made. Pure.
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
  if (!sameTimes(next, previous)) return false;

  const nextParts = next.parts;
  const previousParts = previous.parts;

  if (!isObject(nextParts) || !isObject(previousParts)) return Object.is(nextParts, previousParts);

  // Every written key stored before with the same times, then no stored key left out. A plain object: every key
  // `for…in` walks is its own.
  for (const key in nextParts) {
    if (!Object.hasOwn(previousParts, key) || !sameTimes(nextParts[key], previousParts[key])) {
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

/** The walk of `endsOf` over the keys of `parts`: the run's `hud` and motion, and the latest end found so far. */
const endsWalk: { hud: "none" | readonly string[]; reduced: boolean; ends: number } = {
  hud: "none",
  reduced: false,
  ends: 0
};

/**
 * Takes one key of `parts` into the walk of `endsOf`: its end when the run holds it.
 *
 * @param part - The key's clamped times.
 * @param key - The key.
 */
function endOfPart(part: ClampedReturnPart, key: string): void {
  if (!holds(endsWalk.hud, key)) return;

  endsWalk.ends = Math.max(endsWalk.ends, part.delayMs + (endsWalk.reduced ? 0 : part.fadeMs));
}

/**
 * The game time a run ends at: the last delay plus fade over the keys it holds, the overlay's own included (every key
 * `parts` does not list takes it); under reduced motion, the last delay. Walked once, when the run starts, with
 * `forEach` and a callback made once: a `for…of` over the Map makes an iterator and an entry per key.
 *
 * @param value - The clamped value.
 * @param hud - The `hud` taken at the leave.
 * @param reduced - Reduced motion was on at the leave.
 * @returns Milliseconds of game time from the leave.
 * @example
 * ```ts
 * endsOf({ delayMs: 1100, fadeMs: 400, parts: new Map([["stars", { delayMs: 1400, fadeMs: 400 }]]) }, "none", false); // 1800
 * ```
 */
export function endsOf(
  value: ClampedHudReturn,
  hud: "none" | readonly string[],
  reduced: boolean
): number {
  const ends = value.delayMs + (reduced ? 0 : value.fadeMs);

  if (value.parts === undefined) return ends;

  endsWalk.hud = hud;
  endsWalk.reduced = reduced;
  endsWalk.ends = ends;
  // eslint-disable-next-line unicorn/no-array-for-each, unicorn/no-array-callback-reference -- a Map, no iterator.
  value.parts.forEach(endOfPart);
  // The walk lets the overlay's key list go.
  endsWalk.hud = "none";

  return endsWalk.ends;
}

/**
 * The factor of a return at a moment: 0 before the delay, linear over the fade, 1 after it; a fade of 0 jumps to 1 at
 * the delay. Pure.
 *
 * @param elapsed - Game time since the leave started, ms.
 * @param delay - The part's delay, ms.
 * @param fade - The part's fade, ms.
 * @returns The factor, 0 to 1.
 * @example
 * ```ts
 * returnFactor(1450, 1100, 700); // 0.5
 * ```
 */
export function returnFactor(elapsed: number, delay: number, fade: number): number {
  if (elapsed < delay) return 0;
  if (fade <= 0) return 1;

  return Math.min(1, (elapsed - delay) / fade);
}

/**
 * The factor one run gives a part: 1 for a key it does not hold, else its return at the run's game time, the key's own
 * times read from the clamped copy.
 *
 * @param run - The run.
 * @param key - The part's key.
 * @returns The factor, 0 to 1.
 */
function factorOfRun(run: HudReturnRun, key: string): number {
  if (!holds(run.hud, key)) return 1;

  const { value } = run;
  const part = value.parts?.get(key);
  const delay = part === undefined ? value.delayMs : part.delayMs;
  const fade = part === undefined ? value.fadeMs : part.fadeMs;

  return returnFactor(run.elapsed, delay, run.reduced ? 0 : fade);
}

/**
 * The factor the returns in progress give a part: the product over the runs, 1 with none.
 *
 * @param returns - The runs in progress.
 * @param key - The part's key.
 * @returns The factor, 0 to 1.
 */
export function returnOf(returns: readonly HudReturnRun[], key: string): number {
  let factor = 1;

  // per frame and part: the runs walked by index, normally none or one; `for…of` makes an iterator in the cold tiers.
  // eslint-disable-next-line unicorn/no-for-loop -- the indexed walk allocates nothing.
  for (let index = 0; index < returns.length; index += 1) {
    const run = returns[index];

    if (run !== undefined) factor *= factorOfRun(run, key);
  }

  return factor;
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
  run.endsMs = endsOf(value, hud, reduced);
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
