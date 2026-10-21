/**
 * @file ui/layout — exiting elements, policy "leave": the element leaves the flow in the same
 * reconcile, so its siblings reflow this frame while it plays its exit over them.
 */
import { Exiting } from "../../world/ecs/define";
import type { MotionHandle } from "../../world/projection/types";
import type { MotionCause } from "../../world/types";
import type { Element } from "../jsx/types";
import type { UiCtx } from "../types";
import { play, still } from "./motion";
import { detachNode } from "./nodes";
import type { LayoutState, MotionSpan } from "./types";

/** The dev warning of an element that left while a motion of it repeated forever. */
const EXIT_WAITS_FOREVER = "ui:exit-waits-forever";

/**
 * Starts the exit of one element: out of the Yoga tree at once, tagged `Exiting` so `input`
 * never hits it, then the hook plays over the siblings that already moved. A `change` motion of
 * an extra component that still runs, a counter's roll, is kept, so the sweep waits for it too.
 * One that repeats forever, a hot pulse, is cancelled where it stands: it would never end, and a
 * dev build names the element once (F42).
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
  element.handles = keptExtras(ctx, element);

  const hook = element.motion?.exit;

  play(
    ctx,
    element,
    hook === undefined ? undefined : view => hook(view, element.node, undefined, cause),
    span
  );
}

/**
 * The `change` motions of the extras an exit waits for: the ones still running that can end. One
 * that repeats forever is cancelled where it stands, and a dev build warns once per element.
 *
 * @param ctx - Domain context of the ui plugin.
 * @param element - The element that starts its exit.
 * @returns The motions the sweep waits for.
 */
function keptExtras(ctx: UiCtx, element: Element): MotionHandle[] {
  const kept: MotionHandle[] = [];

  for (const handle of element.extraHandles.values()) {
    if (!handle.active()) continue;

    if (element.endless?.has(handle) !== true) {
      kept.push(handle);

      continue;
    }

    handle.cancel();
    warnEndless(ctx, element);
  }

  return kept;
}

/**
 * Names an element that left while a motion of it repeated forever, once per element, in a dev
 * build: the motion is cut where it stands, which the author may want to end in the exit instead.
 *
 * @param ctx - Domain context of the ui plugin.
 * @param element - The leaving element.
 */
function warnEndless(ctx: UiCtx, element: Element): void {
  // The dev guard is inline: a production `define` folds it away.
  if (typeof __MOKU_GAME_DEV__ === "undefined" || !__MOKU_GAME_DEV__) return;
  if (element.warned.has(EXIT_WAITS_FOREVER)) return;

  element.warned.add(EXIT_WAITS_FOREVER);
  ctx.log.warn(EXIT_WAITS_FOREVER, { key: element.key ?? element.identity });
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
