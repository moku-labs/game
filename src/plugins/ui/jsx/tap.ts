/**
 * @file ui/jsx — what a tap on a button with `local` does: a shallow merge into the local state
 * of the nearest component instance, which is a re-render of that subtree and never an intent.
 */
import { LocalWrite } from "../components";
import type { UiCtx } from "../types";
import { nearestInstance } from "./instances";
import type { JsxState } from "./types";

/**
 * Applies the `LocalWrite` of a tapped entity. A disabled button swallows the tap; a button
 * outside every component is one warning and the tap is dropped.
 *
 * @param ctx - Domain context of the ui plugin.
 * @param entity - The entity `input.onTap` reported.
 */
export function applyTap(ctx: UiCtx, entity: number): void {
  const state: JsxState = ctx.state.jsx;
  const element = state.elements.get(entity);

  if (element === undefined || element.is.disabled) return;

  const write = ctx.deps.world.ecs.get(entity, LocalWrite);

  if (write === undefined) return;

  const instance = nearestInstance(state, element);

  if (instance === undefined) {
    ctx.log.warn("ui:local-write-without-component", { key: element.key });

    return;
  }

  instance.local = { ...instance.local, ...write.patch };
  instance.dirty = true;

  const root = state.roots.get(element.root);

  if (root !== undefined) root.dirty = true;

  ctx.deps.time.wake();
}
