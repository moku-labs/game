/**
 * @file ui — the DebugTrigger counter: five taps within three seconds of wall time open the editor's overlay.
 * Registered on agent pages only (`openRegistrations`), so a release build drops it.
 */
import {
  Draggable,
  Pressable,
  Swipeable,
  Tappable,
  Touchable,
  Traceable
} from "../../input/components";
import type { Entity } from "../../world/types";
import { DebugTrigger } from "../components";
import type { UiCtx } from "../types";

/** How many taps on a trigger view open the overlay. */
const TAPS_TO_OPEN = 5;

/** The window the taps must fall in, milliseconds of wall time, first to last, inclusive. */
const TAP_WINDOW_MS = 3000;

/**
 * Counts one tap at `now` (wall time) and tells whether it was the fifth within the window. The list keeps the last
 * five taps and is emptied on an open, so the next open takes five new taps.
 *
 * @param taps - The wall times of the last taps, five at most; changed in place.
 * @param now - The wall time of this tap.
 * @returns True when this tap is the fifth of five within three seconds.
 * @example
 * ```ts
 * const taps: number[] = [];
 * [0, 700, 1400, 2100].map(at => countTap(taps, at)); countTap(taps, 3000); // true: five taps within 3000 ms
 * ```
 */
export function countTap(taps: number[], now: number): boolean {
  taps.push(now);

  if (taps.length > TAPS_TO_OPEN) taps.shift();

  const first = taps[0] ?? now;

  if (taps.length < TAPS_TO_OPEN || now - first > TAP_WINDOW_MS) return false;

  taps.length = 0;

  return true;
}

/**
 * Names an element in a log line: its key, or its identity when it has none.
 *
 * @param ctx - Domain context of the ui plugin.
 * @param entity - The element's entity.
 * @returns The name.
 */
function keyOf(ctx: UiCtx, entity: Entity): string {
  const element = ctx.state.jsx.elements.get(entity);

  return element === undefined ? String(entity) : (element.key ?? element.identity);
}

/**
 * Opens the overlay for a trigger that counted five taps. Without an overlay on the page it warns once per app.
 *
 * @param ctx - Domain context of the ui plugin.
 * @param key - The trigger view's name.
 */
function openFromTrigger(ctx: UiCtx, key: string): void {
  if (ctx.deps.debug.overlay.open()) {
    ctx.log.info("ui:debug-trigger", { key });

    return;
  }

  if (ctx.state.jsx.debugWarned) return;

  ctx.state.jsx.debugWarned = true;
  ctx.log.warn("ui:debug-trigger-no-agent", { key });
}

/**
 * The `input.onTap` listener of an agent build: a tap on a `DebugTrigger` view counts toward the five. It counts
 * with the page clock, not game time: under a time scale of 0 (the editor's pause) or a slowed game, game time
 * stands still or crawls, and the window must stay three real seconds. `ui` is outside lint L3, so it may read it.
 *
 * @param ctx - Domain context of the ui plugin.
 * @param entity - The tapped entity.
 */
export function debugTap(ctx: UiCtx, entity: Entity): void {
  if (!ctx.deps.world.ecs.has(entity, DebugTrigger)) return;

  if (countTap(ctx.state.jsx.debugTaps, globalThis.performance.now())) {
    openFromTrigger(ctx, keyOf(ctx, entity));
  }
}

/**
 * Warns once when a `DebugTrigger` view takes no touch (no `Tappable`, `Pressable`, `Draggable`, `Swipeable`,
 * `Traceable` or `Touchable`): five taps can never reach it. The extras are added after the element's own input
 * components, so those are present when the hook runs.
 *
 * @param ctx - Domain context of the ui plugin.
 * @param entity - The entity that gained the tag.
 */
export function checkTrigger(ctx: UiCtx, entity: Entity): void {
  const { ecs } = ctx.deps.world;
  const takesPress =
    ecs.has(entity, Tappable) ||
    ecs.has(entity, Pressable) ||
    ecs.has(entity, Draggable) ||
    ecs.has(entity, Swipeable) ||
    ecs.has(entity, Traceable) ||
    ecs.has(entity, Touchable);

  if (takesPress) return;

  const element = ctx.state.jsx.elements.get(entity);
  const event = "ui:debug-trigger-untouchable";

  if (element?.warned.has(event) === true) return;

  element?.warned.add(event);
  ctx.log.warn(event, { key: keyOf(ctx, entity) });
}
