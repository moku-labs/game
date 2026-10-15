/**
 * @file ui/layout — exiting elements, policy "leave": the element leaves the flow in the same
 * reconcile, so its siblings reflow this frame while it plays its exit over them.
 */
import { Exiting } from "../../world/ecs/define";
import type { MotionCause } from "../../world/types";
import type { Element } from "../jsx/types";
import type { UiCtx } from "../types";
import { play, still } from "./motion";
import { detachNode } from "./nodes";
import type { LayoutState, MotionSpan } from "./types";

/**
 * Starts the exit of one element: out of the Yoga tree at once, tagged `Exiting` so `input`
 * never hits it, then the hook plays over the siblings that already moved. A `change` motion of
 * an extra component that still runs, a counter's roll, is kept, so the sweep waits for it too.
 *
 * @param ctx - Domain context of the ui plugin.
 * @param state - The layout state.
 * @param element - The element that left the description.
 * @param cause - Why it leaves: a `when: "change"` hook plays nothing for `"mount"`, and the next sweep takes it.
 * @param span - Notes the longest finite track the exit hook starts, for the level of an overlay.
 */
export function beginExit(
  ctx: UiCtx,
  state: LayoutState,
  element: Element,
  cause: MotionCause,
  span?: MotionSpan
): void {
  detachNode(state, element);
  element.dropKey?.();
  element.dropKey = undefined;

  if (!element.live) return;

  ctx.deps.world.ecs.tag(element.entity, Exiting);
  element.handles = [...element.extraHandles.values()].filter(handle => handle.active());

  const hook = element.motion?.exit;

  play(
    ctx,
    element,
    hook === undefined ? undefined : view => hook(view, element.node, undefined, cause),
    span
  );
}

/**
 * Tells whether an exiting element may be despawned: no hook, or every hook finished.
 *
 * @param element - The exiting element.
 * @returns True when the sweep of the next reconcile takes it.
 * @example
 * ```ts
 * canDespawn({ handles: [] } as unknown as Element); // true
 * ```
 */
export function canDespawn(element: Element): boolean {
  return still(element);
}
