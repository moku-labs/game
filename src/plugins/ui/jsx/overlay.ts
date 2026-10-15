/**
 * @file ui — the level and the landing of overlays (spec 22 O4): ui writes `OverlayLevel.level` as a track of the
 * element's own motion and `OverlayLevel.landed` when its enter motion is over; the renderer reads both. The level
 * follows the root's own enter and exit motion (its longest timed track); `fade` times it only when the root plays
 * none (LEAD-FIXES-4 item 5a). The layout module plays the tracks: it is injected, never imported.
 */
import { Overlay, OverlayLevel, type OverlayValue } from "../../renderer/components";
import { Exiting } from "../../world/ecs/define";
import type { TweenOptions } from "../../world/projection/types";
import type { AnyComponentValue, ComponentValue, Ease } from "../../world/types";
import type { LayoutModule, MotionSpan } from "../layout/types";
import type { UiCtx } from "../types";
import type { Element, JsxState } from "./types";

/**
 * What the overlay level needs of the layout module: playing a track as one of the element's motions, and whether
 * every motion of the element is over.
 */
export type OverlayLayout = Pick<LayoutModule, "playTrack" | "settled">;

/**
 * Tells whether an extra of an element is the `Overlay` marker.
 *
 * @param value - An extra component value.
 * @returns True for an `Overlay` value.
 */
function isOverlay(value: AnyComponentValue): value is ComponentValue<OverlayValue> {
  return value.type === Overlay;
}

/**
 * An empty span, to measure the motion hook of an overlay's root with: no track noted yet.
 *
 * @returns The span.
 * @example
 * ```ts
 * createSpan().end; // 0
 * ```
 */
export function createSpan(): MotionSpan {
  return { end: 0, ms: 0, delayMs: 0, ease: undefined, reduced: undefined };
}

/**
 * The `Overlay` value an element declares in its components, read from its extras (its spawn is queued until the
 * phase flush, so the ECS does not hold it yet at enter).
 *
 * @param element - The element.
 * @returns The marker, or `undefined` for an element that is no overlay.
 */
export function overlayOf(element: Element): Readonly<OverlayValue> | undefined {
  const extra = element.extras.get(Overlay.componentName);

  return extra !== undefined && isOverlay(extra) ? extra.value : undefined;
}

/**
 * The track of the level: the root's own motion when it played a timed track, else `fade` with the default ease and
 * kept under reduced motion (it is a fade). `undefined` when the level is set at once.
 *
 * @param span - The longest timed track of the root's hook.
 * @param fade - The marker's `fade`.
 * @param ease - The ease of the fade: `"out"` on the way in, `"in"` on the way out.
 * @returns The options, or `undefined` for a level written at once.
 */
function levelTrack(span: MotionSpan, fade: number, ease: Ease): TweenOptions | undefined {
  if (span.end > 0) {
    return {
      ms: span.ms,
      delayMs: span.delayMs,
      ease: span.ease ?? ease,
      ...(span.reduced === undefined ? {} : { reduced: span.reduced })
    };
  }

  if (!Number.isFinite(fade) || fade <= 0) return undefined;

  return { ms: fade, ease, reduced: "keep" };
}

/**
 * Moves the level of an overlay to a target: a track of the element's own motion (one of its handles, so its landing
 * and its despawn wait for it), or at once.
 *
 * @param ctx - Domain context of the ui plugin.
 * @param layout - The layout module.
 * @param element - The marked element.
 * @param target - The level and its track: 1 on the way in, 0 on the way out; no track for at once.
 * @param target.level - The level to reach.
 * @param target.track - The track, or `undefined` for at once.
 */
function levelTo(
  ctx: UiCtx,
  layout: OverlayLayout,
  element: Element,
  target: { level: number; track: TweenOptions | undefined }
): void {
  const { level, track } = target;

  if (track === undefined) {
    ctx.deps.world.ecs.set(element.entity, OverlayLevel, { level });

    return;
  }

  layout.playTrack(element, view => view.tween(OverlayLevel, { level }, track));
}

/**
 * Starts the level of an entering overlay with its enter motion: 0 to 1 over the root's own motion, or over `fade`
 * when it played none; `fade` 0 sets it at once, and the next solve lands it.
 *
 * @param ctx - Domain context of the ui plugin.
 * @param state - The jsx state.
 * @param layout - The layout module.
 * @param entering - The entering element and the longest timed track its enter hook started.
 * @param entering.element - The entering element.
 * @param entering.span - The span its enter hook played.
 */
export function enterOverlay(
  ctx: UiCtx,
  state: JsxState,
  layout: OverlayLayout,
  entering: { element: Element; span: MotionSpan }
): void {
  const { element, span } = entering;
  const value = overlayOf(element);

  if (value === undefined) return;

  state.overlays.add(element.entity);
  levelTo(ctx, layout, element, { level: 1, track: levelTrack(span, value.fade, "out") });
}

/**
 * Takes the level of a leaving overlay back to 0 with its exit motion, after the exit hook played, so the sweep
 * despawns the overlay only once its exit and the level are both over: the dim and the HUD parts are back first.
 *
 * @param ctx - Domain context of the ui plugin.
 * @param layout - The layout module.
 * @param element - The leaving element.
 * @param span - The longest timed track its exit hook started.
 */
export function exitOverlay(
  ctx: UiCtx,
  layout: OverlayLayout,
  element: Element,
  span: MotionSpan
): void {
  const value = overlayOf(element);

  if (value === undefined || !element.live) return;

  levelTo(ctx, layout, element, { level: 0, track: levelTrack(span, value.fade, "in") });
}

/**
 * Lands every overlay whose enter motion and level track are over, and forgets those that left: one size check in a
 * frame with no overlay. A landing wakes the loop, so a renderer drawing on demand sees it.
 *
 * @param ctx - Domain context of the ui plugin.
 * @param state - The jsx state.
 * @param layout - The layout module.
 */
export function settleOverlays(ctx: UiCtx, state: JsxState, layout: OverlayLayout): void {
  if (state.overlays.size === 0) return;

  const ecs = ctx.deps.world.ecs;

  for (const entity of state.overlays) {
    const element = state.elements.get(entity);

    if (element === undefined) {
      state.overlays.delete(entity);

      continue;
    }

    if (state.exiting.has(entity) || ecs.has(entity, Exiting)) continue;
    if (ecs.get(entity, OverlayLevel)?.landed !== false || !layout.settled(element)) continue;

    ecs.set(entity, OverlayLevel, { landed: true });
    ctx.deps.time.wake();
  }
}
