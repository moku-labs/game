/**
 * @file input plugin — the hover of a mouse or a pen. `PointerOver` sits on the topmost view a
 * press would take, found with the same filter a press uses. At most one view carries it. A touch
 * never hovers: a touch sample, a pointer cancel and the pointer leaving the canvas take it away.
 */
import { PointerOver, type PointerValue } from "./components";
import { findPressed } from "./hit";
import type { InputCtx, Point, RawSample } from "./types";

/**
 * Takes `PointerOver` away from the view that carries it, if any.
 *
 * @param ctx - Domain context of the input plugin.
 */
export function clearPointerOver(ctx: InputCtx): void {
  const { pointerOver } = ctx.state;

  if (pointerOver !== undefined) ctx.deps.world.ecs.untag(pointerOver, PointerOver);
  ctx.state.pointerOver = undefined;
}

/**
 * Moves `PointerOver` to the topmost view a press would take at a point. The view that had it
 * loses it; nothing is written when the pointer is still over the same view.
 *
 * @param ctx - Domain context of the input plugin.
 * @param point - Where the pointer is, in reference units.
 */
export function movePointerOver(ctx: InputCtx, point: Point): void {
  const found = findPressed(ctx, point.x, point.y);

  if (found === ctx.state.pointerOver) return;

  clearPointerOver(ctx);
  ctx.state.pointerOver = found;
  if (found !== undefined) ctx.deps.world.ecs.tag(found, PointerOver);
}

/**
 * Tells whether a sample ends the hover: any touch, a pointer cancel, or the pointer leaving the
 * canvas. A lost capture does not: the browser sends one after every click.
 *
 * @param sample - The raw sample.
 * @returns True when `PointerOver` has to go.
 * @example
 * ```ts
 * endsHover({ kind: "lost", pointerType: "mouse", pointerId: 1, clientX: 0, clientY: 0 }); // false
 * ```
 */
export function endsHover(sample: RawSample): boolean {
  return sample.pointerType === "touch" || sample.kind === "cancel" || sample.kind === "leave";
}

/**
 * Tells whether a move sample is a hover: a mouse or a pen with no gesture running and no button
 * down. Any other move belongs to the gesture machine.
 *
 * @param ctx - Domain context of the input plugin.
 * @param pointer - The `Pointer` resource of this frame.
 * @param sample - The move sample.
 * @returns True when the move only moves `PointerOver`.
 */
export function isHover(ctx: InputCtx, pointer: PointerValue, sample: RawSample): boolean {
  return sample.pointerType !== "touch" && ctx.state.phase === "idle" && !pointer.down;
}
