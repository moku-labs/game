/**
 * @file ui/layout — scroll. A scroll container moves its content on its axis: with the finger,
 * then in a fling that slows down, or in a glide to a `snap` stop; it starts at its `offset`
 * prop, glides when the prop changes, and stays inside the range every solve gives it, with hard
 * edges. The content moves by one `Transform` write on the axis: no solve, no motion, the children
 * keep their rects. `Scroll` holds the offset the way the windowed range is cut with (0 and below),
 * `ScrollState` the way a game reads it (0 to `max`), `Scrollable` whether it moves, for `input`.
 * The exact numbers live on the element's `scroll` record and the samples of the press in the
 * layout state, written in place; the components get whole reference units. A frame allocates
 * nothing.
 */
import { Pointer, type PointerValue, Pressed, Scrollable } from "../../input/components";
import { Transform } from "../../renderer/components";
import type { Time } from "../../time/types";
import { Scroll, ScrollState } from "../components";
import type { Element, ScrollMotion } from "../jsx/types";
import type { UiCtx } from "../types";
import type { ElementLookup, LayoutState } from "./types";

/** How far ahead a release carries its velocity before the nearest `snap` stop is taken, in ms. */
const PROJECT_MS = 260;

/** What a fling keeps of its velocity per ms. */
const DECAY_PER_MS = 0.998;

/** The speed under which a fling stops, in reference units per ms. */
const STOP_SPEED = 0.02;

/** The shortest glide, in ms. */
const GLIDE_MS = 260;

/** The ms each reference unit of distance adds to a glide. */
const GLIDE_MS_PER_UNIT = 1.1;

/** The longest glide, in ms. */
const GLIDE_MAX_MS = 620;

/** The samples of the last ms before a release give its velocity. */
const VELOCITY_MS = 100;

/** A finger that stood still for longer than this before its release lets go with no velocity, in ms. */
const STILL_MS = 50;

/**
 * Keeps an offset inside the scrollable range: never below the end of the content, never above
 * the top.
 *
 * @param offset - Where the content would go.
 * @param min - The most negative offset, which is viewport height minus content height.
 * @returns The offset the content is written with.
 * @example
 * ```ts
 * clampOffset(40, -300); // 0
 * ```
 */
export function clampOffset(offset: number, min: number): number {
  return Math.min(0, Math.max(min, offset));
}

/**
 * Keeps an offset from the start inside 0 to `max`.
 *
 * @param offset - Where the content would stand, from the start.
 * @param max - The largest offset.
 * @returns The offset it stands at.
 * @example
 * ```ts
 * within(420, 390); // 390
 * ```
 */
function within(offset: number, max: number): number {
  return Math.min(max, Math.max(0, offset));
}

/**
 * How far a length runs past a window, in whole reference units: 0 when it fits.
 *
 * @param length - What is scrolled.
 * @param window - What shows of it.
 * @returns The largest offset.
 * @example
 * ```ts
 * extent(696, 306); // 390
 * ```
 */
function extent(length: number, window: number): number {
  return Math.max(0, Math.round(length - window));
}

/**
 * The content entity of a scroll container: its single child.
 *
 * @param container - The scroll element.
 * @param lookup - How a child entity becomes its element.
 * @returns The content element, or `undefined`.
 */
function contentOf(container: Element, lookup: ElementLookup): Element | undefined {
  const first = container.children[0];

  return first === undefined ? undefined : lookup(first);
}

/**
 * The largest offset of a scroll on its axis: its content's rect past its own, or
 * `rows × rowHeight` past its height for a windowed scroll.
 *
 * @param container - The scroll element, with a solved rect.
 * @param content - Its content element.
 * @param axis - The axis it moves on.
 * @returns The largest offset, in whole reference units.
 */
function maxOf(container: Element, content: Element, axis: ScrollMotion["axis"]): number {
  if (axis === "x") return extent(content.rect.w, container.rect.w);

  const window = container.window;
  const length = window === undefined ? content.rect.h : window.rows * window.rowHeight;

  return extent(length, container.rect.h);
}

/**
 * The `offset` prop of the scroll's last render: 0 when it is left out or is no finite number.
 *
 * @param container - The scroll element.
 * @returns The offset it asks for, from the start.
 */
function askedOffsetOf(container: Element): number {
  const offset = container.node.props.offset;

  return typeof offset === "number" && Number.isFinite(offset) ? offset : 0;
}

/**
 * The `snap` prop of the scroll's last render.
 *
 * @param container - The scroll element.
 * @returns The stops, or `undefined` when it names none.
 */
function snapOf(container: Element): readonly unknown[] | undefined {
  const snap: unknown = container.node.props.snap;

  return Array.isArray(snap) && snap.length > 0 ? snap : undefined;
}

/**
 * The stop nearest to an offset, each stop kept inside 0 to `max`; the first of two as near.
 *
 * @param snap - The stops the scroll names.
 * @param offset - Where the release would carry it.
 * @param max - The largest offset.
 * @param fallback - Where it stays when no stop is a number.
 * @returns The stop.
 * @example
 * ```ts
 * nearestStop([0, 318, 390], 300, 390, 300); // 318
 * ```
 */
function nearestStop(
  snap: readonly unknown[],
  offset: number,
  max: number,
  fallback: number
): number {
  let nearest = fallback;
  let distance = Number.POSITIVE_INFINITY;

  for (const candidate of snap) {
    // A stop that is no number is skipped; a NaN one is never nearer than another.
    if (typeof candidate !== "number") continue;

    const kept = within(candidate, max);

    if (Math.abs(kept - offset) < distance) {
      nearest = kept;
      distance = Math.abs(kept - offset);
    }
  }

  return nearest;
}

/**
 * Stops a scroll where it stands.
 *
 * @param motion - Its motion.
 */
function stop(motion: ScrollMotion): void {
  motion.mode = "still";
  motion.velocity = 0;
}

/**
 * Starts a glide to an offset, kept inside the range, on the curve `1 − (1 − p)³` over
 * `min(620, 260 + distance × 1.1)` ms. A scroll already there stops instead.
 *
 * @param motion - Its motion.
 * @param target - Where it goes, from the start.
 */
function glideTo(motion: ScrollMotion, target: number): void {
  const to = within(target, motion.max);
  const distance = Math.abs(to - motion.offset);

  if (distance === 0) {
    stop(motion);

    return;
  }

  motion.mode = "glide";
  motion.velocity = 0;
  motion.from = motion.offset;
  motion.to = to;
  motion.elapsed = 0;
  motion.duration = Math.min(GLIDE_MAX_MS, GLIDE_MS + distance * GLIDE_MS_PER_UNIT);
}

/**
 * Follows the finger on a held scroll. The first frame of a press, a hand-off included, takes the
 * finger where it is as the start and stops a fling or a glide where it stands; the offset then
 * moves against the finger, inside 0 to `max`. Every frame adds the finger's sample to the ring.
 *
 * @param state - The layout state, which keeps the samples of the press.
 * @param container - The held scroll.
 * @param motion - Its motion.
 * @param pointer - The `Pointer` resource of this frame.
 */
function hold(
  state: LayoutState,
  container: Element,
  motion: ScrollMotion,
  pointer: Readonly<PointerValue>
): void {
  const at = motion.axis === "x" ? pointer.x : pointer.y;
  const ring = state.scrollRing;
  const slots = ring.length / 2;

  if (motion.mode !== "held" || state.scrolling !== container.entity) {
    motion.mode = "held";
    motion.velocity = 0;
    motion.pointer = at;
    motion.start = motion.offset;
    state.scrolling = container.entity;
    state.scrollSamples = 0;
    state.scrollMoved = state.scrollClock;
  }

  motion.offset = within(motion.start - (at - motion.pointer), motion.max);

  // Per frame: the sample goes into the ring in place; the finger moved when it left the last one.
  const last = ((state.scrollHead + slots - 1) % slots) * 2;

  if (state.scrollSamples > 0 && ring[last] !== at) state.scrollMoved = state.scrollClock;

  ring[state.scrollHead * 2] = at;
  ring[state.scrollHead * 2 + 1] = state.scrollClock;
  state.scrollHead = (state.scrollHead + 1) % slots;
  state.scrollSamples = Math.min(slots, state.scrollSamples + 1);
}

/**
 * The velocity of the offset at a release, in units a ms, positive toward `max`: the finger's
 * move over its samples of the last 100 ms, against the finger. 0 when the finger stood still for
 * more than 50 ms before it let go, or left a single sample.
 *
 * @param state - The layout state, which keeps the samples of the press.
 * @returns The velocity.
 */
function releaseVelocity(state: LayoutState): number {
  const ring = state.scrollRing;
  const slots = ring.length / 2;
  const now = state.scrollClock;

  if (state.scrollSamples < 2 || now - state.scrollMoved > STILL_MS) return 0;

  const newest = ((state.scrollHead + slots - 1) % slots) * 2;
  let oldest = newest;

  for (let back = 1; back < state.scrollSamples; back += 1) {
    const slot = ((state.scrollHead + 2 * slots - 1 - back) % slots) * 2;

    if ((ring[slot + 1] ?? 0) < now - VELOCITY_MS) break;

    oldest = slot;
  }

  const span = (ring[newest + 1] ?? 0) - (ring[oldest + 1] ?? 0);

  return span > 0 ? ((ring[oldest] ?? 0) - (ring[newest] ?? 0)) / span : 0;
}

/**
 * Lets go of a scroll the finger held. With `snap` it glides to the stop nearest to where its
 * velocity carries in 260 ms; without, it flings, or stands when it was let go too slowly. A
 * press whose samples a later press took lets go with no velocity.
 *
 * @param state - The layout state, which keeps the samples of the press.
 * @param container - The scroll that was held.
 * @param motion - Its motion.
 * @param owned - Whether the samples are this press's.
 */
function letGo(state: LayoutState, container: Element, motion: ScrollMotion, owned: boolean): void {
  const velocity = owned ? releaseVelocity(state) : 0;
  const snap = snapOf(container);

  if (snap !== undefined) {
    const projected = motion.offset + velocity * PROJECT_MS;

    glideTo(motion, nearestStop(snap, projected, motion.max, motion.offset));

    return;
  }

  if (Math.abs(velocity) < STOP_SPEED) {
    stop(motion);

    return;
  }

  motion.mode = "fling";
  motion.velocity = velocity;
}

/**
 * Moves a flinging scroll by the frame: the offset by its velocity, the velocity down by 0.998 a
 * ms. It stops under 0.02 units a ms, or on an edge: the edges are hard and nothing passes the
 * rest of the fling to a parent.
 *
 * @param motion - Its motion.
 * @param time - The frame's `Time`.
 */
function fling(motion: ScrollMotion, time: Readonly<Time>): void {
  const delta = time.delta;
  const next = motion.offset + motion.velocity * delta;

  motion.offset = within(next, motion.max);
  motion.velocity *= DECAY_PER_MS ** delta;

  if (motion.offset !== next || Math.abs(motion.velocity) < STOP_SPEED) stop(motion);
}

/**
 * Moves a gliding scroll by the frame along `1 − (1 − p)³`; at its end it stands on its target.
 *
 * @param motion - Its motion.
 * @param time - The frame's `Time`.
 */
function glide(motion: ScrollMotion, time: Readonly<Time>): void {
  motion.elapsed += time.delta;

  const progress = Math.min(1, motion.elapsed / motion.duration);

  if (progress === 1) {
    motion.offset = motion.to;
    stop(motion);

    return;
  }

  const left = 1 - progress;

  motion.offset = motion.from + (motion.to - motion.from) * (1 - left * left * left);
}

/**
 * Moves the content to a whole offset on the scroll's axis, from where the solve put it: one
 * `Transform` write, none when it stands there already. The rects of the solve are whole numbers
 * that Yoga hands out as doubles; rounded, the pose is a small integer, which `Object.assign`
 * copies into the world without a box.
 *
 * @param ctx - Domain context of the ui plugin.
 * @param state - The layout state, which keeps the patches.
 * @param container - The scroll element.
 * @param content - Its content element.
 * @param motion - Its motion.
 */
function moveContent(
  ctx: UiCtx,
  state: LayoutState,
  container: Element,
  content: Element,
  motion: ScrollMotion
): void {
  const ecs = ctx.deps.world.ecs;
  const pose = ecs.get(content.entity, Transform);
  const offset = Math.round(motion.offset);

  if (pose === undefined) return;

  if (motion.axis === "x") {
    const x = Math.round(content.rect.x - container.rect.x) - offset;

    if (pose.x === x) return;

    state.scrollPatches.x.x = x;
    ecs.set(content.entity, Transform, state.scrollPatches.x);

    return;
  }

  const y = Math.round(content.rect.y - container.rect.y) - offset;

  if (pose.y === y) return;

  state.scrollPatches.y.y = y;
  ecs.set(content.entity, Transform, state.scrollPatches.y);
}

/**
 * Writes what changed of a scroll, in whole units: `Scroll` when its offset or range moved,
 * `ScrollState` when the offset, `max` or `moving` changed, `Scrollable` when `moving` did, and
 * the content's pose. A frame where nothing changed writes nothing.
 *
 * @param ctx - Domain context of the ui plugin.
 * @param state - The layout state, which keeps the patches.
 * @param container - The scroll element.
 * @param content - Its content element.
 * @param motion - Its motion.
 */
function show(
  ctx: UiCtx,
  state: LayoutState,
  container: Element,
  content: Element,
  motion: ScrollMotion
): void {
  const ecs = ctx.deps.world.ecs;
  const patches = state.scrollPatches;
  const offset = Math.round(motion.offset);
  const moving = motion.mode !== "still";
  const scroll = ecs.get(container.entity, Scroll);
  const shown = ecs.get(container.entity, ScrollState);
  const scrollable = ecs.get(container.entity, Scrollable);

  if (scroll !== undefined && (scroll.offset !== 0 - offset || scroll.min !== 0 - motion.max)) {
    patches.scroll.offset = 0 - offset;
    patches.scroll.min = 0 - motion.max;
    ecs.set(container.entity, Scroll, patches.scroll);
  }

  if (
    shown !== undefined &&
    (shown.offset !== offset || shown.max !== motion.max || shown.moving !== moving)
  ) {
    patches.state.offset = offset;
    patches.state.max = motion.max;
    patches.state.moving = moving;
    ecs.set(container.entity, ScrollState, patches.state);
  }

  if (scrollable !== undefined && scrollable.moving !== moving) {
    patches.scrollable.moving = moving;
    ecs.set(container.entity, Scrollable, patches.scrollable);
  }

  moveContent(ctx, state, container, content, motion);
}

/**
 * Moves one scroll by the frame: the finger while it is pressed, the release when it lets go,
 * then a fling or a glide, and writes what changed. A still scroll no finger is on costs a tag
 * check.
 *
 * @param ctx - Domain context of the ui plugin.
 * @param state - The layout state.
 * @param container - The live scroll element.
 * @param lookup - How a child entity becomes its element.
 * @param pointer - The `Pointer` resource of this frame.
 * @param time - The frame's `Time`.
 * @returns True while the scroll moves.
 */
function stepOne(
  ctx: UiCtx,
  state: LayoutState,
  container: Element,
  lookup: ElementLookup,
  pointer: Readonly<PointerValue>,
  time: Readonly<Time>
): boolean {
  const ecs = ctx.deps.world.ecs;
  const pressed = ecs.has(container.entity, Pressed);
  // The press the samples belong to ends whatever the container holds now.
  const released = !pressed && state.scrolling === container.entity;

  if (released) state.scrolling = undefined;

  const motion = container.scroll;

  if (motion === undefined || !motion.placed || (!pressed && motion.mode === "still")) return false;

  const content = contentOf(container, lookup);

  if (content === undefined || !ecs.has(container.entity, Scroll)) return false;

  if (pressed) hold(state, container, motion, pointer);
  else if (motion.mode === "held") letGo(state, container, motion, released);

  if (motion.mode === "fling") fling(motion, time);
  else if (motion.mode === "glide") glide(motion, time);

  show(ctx, state, container, content, motion);

  return motion.mode !== "still";
}

/**
 * Moves every scroll container by the frame: with the finger while it is pressed, then in a
 * fling or a glide after it lets go. Time is the frame's `delta`, so a time scale and a pause
 * apply. While a scroll moves, `time.wake()` keeps the frames coming.
 *
 * @param ctx - Domain context of the ui plugin.
 * @param state - The layout state, which keeps the samples of the press.
 * @param containers - The live scroll elements.
 * @param lookup - How a child entity becomes its element.
 * @param time - The frame's `Time`.
 */
export function stepScroll(
  ctx: UiCtx,
  state: LayoutState,
  containers: readonly Element[],
  lookup: ElementLookup,
  time: Readonly<Time>
): void {
  const pointer = ctx.deps.world.ecs.resource(Pointer);
  let moving = false;

  state.scrollClock += time.delta;

  for (const container of containers) {
    if (stepOne(ctx, state, container, lookup, pointer, time)) moving = true;
  }

  if (moving) ctx.deps.time.wake();
}

/**
 * Takes a new range: the offset keeps inside it at once, and so does a running glide.
 *
 * @param motion - The motion of the scroll.
 * @param max - The largest offset the solve gives it now.
 */
function resize(motion: ScrollMotion, max: number): void {
  if (max === motion.max) return;

  motion.max = max;
  motion.offset = within(motion.offset, max);
  motion.from = within(motion.from, max);
  motion.to = within(motion.to, max);
}

/**
 * Puts a scroll the solve just spawned at its `offset` prop, inside its range. Its spawn waits in
 * the queue of the phase: these values replace the queued ones at the flush, before the first
 * draw.
 *
 * @param ctx - Domain context of the ui plugin.
 * @param container - The scroll element, live since this solve.
 * @param content - Its content element.
 * @param motion - Its motion, not placed yet.
 */
function place(ctx: UiCtx, container: Element, content: Element, motion: ScrollMotion): void {
  const ecs = ctx.deps.world.ecs;
  const rest = content.rest;

  motion.placed = true;
  motion.max = maxOf(container, content, motion.axis);
  motion.seen = askedOffsetOf(container);
  motion.offset = within(motion.seen, motion.max);

  const offset = Math.round(motion.offset);
  const pose =
    motion.axis === "x"
      ? { ...rest, x: content.rect.x - container.rect.x - offset }
      : { ...rest, y: content.rect.y - container.rect.y - offset };

  ecs.add(container.entity, Scroll({ axis: motion.axis, offset: 0 - offset, min: 0 - motion.max }));
  ecs.add(container.entity, ScrollState({ offset, max: motion.max, moving: false }));
  ecs.add(content.entity, Transform(pose));
}

/**
 * Settles a placed scroll on what the solve and the render of this frame gave it: a new range at
 * once, then a glide to a new `offset` prop, which a scroll the finger holds only remembers.
 *
 * @param ctx - Domain context of the ui plugin.
 * @param state - The layout state, which keeps the patches.
 * @param container - The scroll element.
 * @param content - Its content element.
 * @param motion - Its motion, placed.
 */
function settle(
  ctx: UiCtx,
  state: LayoutState,
  container: Element,
  content: Element,
  motion: ScrollMotion
): void {
  resize(motion, maxOf(container, content, motion.axis));

  const asked = askedOffsetOf(container);

  if (asked !== motion.seen) {
    motion.seen = asked;

    if (motion.mode !== "held") glideTo(motion, asked);
  }

  show(ctx, state, container, content, motion);
}

/**
 * Settles every scroll on what the solve and the render of this frame gave it. A scroll the solve
 * just spawned takes its place at its `offset` prop. A placed one keeps inside a new range at
 * once, a running glide's target too, and glides to a new `offset` prop; the same value on a
 * re-render does nothing, and a scroll the finger holds only remembers it.
 *
 * @param ctx - Domain context of the ui plugin.
 * @param state - The layout state, which keeps the patches.
 * @param containers - The live scroll elements.
 * @param lookup - How a child entity becomes its element.
 */
export function settleScroll(
  ctx: UiCtx,
  state: LayoutState,
  containers: readonly Element[],
  lookup: ElementLookup
): void {
  let moving = false;

  for (const container of containers) {
    const motion = container.scroll;
    const content = contentOf(container, lookup);

    if (motion === undefined || content === undefined) continue;

    if (motion.placed) settle(ctx, state, container, content, motion);
    else place(ctx, container, content, motion);

    if (motion.mode !== "still") moving = true;
  }

  if (moving) ctx.deps.time.wake();
}

/**
 * Re-clamps a live windowed scroll to the content height of its new rows before its range is
 * cut, so a list that shrank below the window moves up in the same frame.
 *
 * @param ctx - Domain context of the ui plugin.
 * @param state - The layout state, which keeps the patches.
 * @param container - The live scroll element.
 * @param contentHeight - `rows × rowHeight` of this render.
 * @param lookup - How a child entity becomes its element.
 * @returns The offset the content stands at, 0 and below, as `Scroll` holds it.
 */
export function clampScroll(
  ctx: UiCtx,
  state: LayoutState,
  container: Element,
  contentHeight: number,
  lookup: ElementLookup
): number {
  const motion = container.scroll;
  const content = contentOf(container, lookup);

  // A live scroll was placed by the solve that spawned it; before that it stands at 0.
  if (motion === undefined || !motion.placed || content === undefined) return 0;

  resize(motion, extent(contentHeight, container.rect.h));
  show(ctx, state, container, content, motion);

  return 0 - Math.round(motion.offset);
}

/**
 * Puts a placed scroll at an offset at once, inside its range: a fling or a glide stops, and
 * `ScrollState` says it stands. A finger that holds it goes on from there.
 *
 * @param ctx - Domain context of the ui plugin.
 * @param state - The layout state, which keeps the patches.
 * @param container - The scroll element.
 * @param to - Where it goes, from the start; `NaN` leaves it where it is.
 * @param lookup - How a child entity becomes its element.
 * @returns True when the scroll took it; false before its first solve placed it.
 */
export function scrollTo(
  ctx: UiCtx,
  state: LayoutState,
  container: Element,
  to: number,
  lookup: ElementLookup
): boolean {
  const motion = container.scroll;
  const content = contentOf(container, lookup);

  if (motion === undefined || !motion.placed || content === undefined) return false;

  motion.offset = within(Number.isNaN(to) ? motion.offset : to, motion.max);
  stop(motion);
  show(ctx, state, container, content, motion);
  ctx.deps.time.wake();

  return true;
}
