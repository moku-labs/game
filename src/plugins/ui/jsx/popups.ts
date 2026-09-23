/**
 * @file ui/jsx — popup roots that outlive their answer. A root whose effect ended waits until the
 * flow rests on a node that shows no popup of its component; a popup of the same component that
 * arrives first takes the root back; `over` keeps another popup mounted and covered beneath.
 */
import type { FlowState } from "../../flow/types";
import { Tree } from "../../world/ecs/define";
import type { Entity } from "../../world/types";
import { Covered } from "../components";
import type { UiCtx } from "../types";
import type { JsxState, PopupLink, Root } from "./types";

/**
 * Tells whether the flow has come to rest: its loop is not running, it stands on no node, or the
 * node it stands on waits for the player (the gate is open). A node that shows a popup opens the
 * gate too, and that popup has already taken its root back when the gate opens.
 *
 * @param flow - What `flow.state()` answered.
 * @returns True when a released popup root may leave.
 * @example
 * ```ts
 * flowRests({ running: true, path: "home", stack: [], pending: { gate: ["play"] }, mode: "live" }); // true
 * ```
 */
export function flowRests(flow: FlowState): boolean {
  return !flow.running || flow.stack.length === 0 || flow.pending.gate !== undefined;
}

/**
 * The newest mounted popup root of one component that is not on its way out.
 *
 * @param state - The jsx state.
 * @param component - The component name.
 * @param skip - A root that does not count, the one asking.
 * @returns The root, or `undefined`.
 */
function newestPopup(state: JsxState, component: string, skip?: Entity): Root | undefined {
  let found: Root | undefined;

  for (const root of state.roots.values()) {
    if (root.popup === undefined || root.name !== component || root.entity === skip) continue;
    if (state.removing.has(root.entity)) continue;
    if (found === undefined || root.order > found.order) found = root;
  }

  return found;
}

/**
 * Marks a popup root covered or uncovered: the tag on the root entity, and a dirty root, so every
 * element resolves `is.covered` again at the next reconcile.
 *
 * @param ctx - Domain context of the ui plugin.
 * @param root - The popup root.
 * @param covered - Whether a popup lies over it now.
 */
function setCovered(ctx: UiCtx, root: Root, covered: boolean): void {
  if (root.covered === covered) return;

  const ecs = ctx.deps.world.ecs;

  root.covered = covered;
  root.dirty = true;

  if (covered) ecs.tag(root.entity, Covered);
  else ecs.untag(root.entity, Covered);

  ctx.deps.time.wake();
}

/**
 * Takes back a released root of the same component for a new `popup` effect: the old handler is
 * done, the new one owns the root, the props are patched through `Tree` and the instance keeps its
 * `local`. No exit and no enter motion: the elements are patched, not remounted.
 *
 * @param ctx - Domain context of the ui plugin.
 * @param state - The jsx state.
 * @param component - The component the effect shows.
 * @param props - The props of the new effect.
 * @param link - The popup side of the new handler.
 * @returns The root entity taken back, or `undefined` when none waits.
 */
export function reclaimPopup(
  ctx: UiCtx,
  state: JsxState,
  component: string,
  props: object,
  link: PopupLink
): Entity | undefined {
  const root = newestPopup(state, component);

  if (root?.popup?.released !== true) return undefined;

  const previous = root.popup;

  root.popup = link;
  previous.close();
  setCovered(ctx, root, false);
  ctx.deps.world.ecs.set(root.entity, Tree, { node: { type: component, props, children: [] } });
  root.dirty = true;
  ctx.deps.time.wake();

  return root.entity;
}

/**
 * Keeps the newest popup of the component `over` names beneath a new popup, covered. A name with
 * no mounted popup is one warning and nothing is covered.
 *
 * @param ctx - Domain context of the ui plugin.
 * @param state - The jsx state.
 * @param over - The component name of the popup to keep beneath.
 * @param coverer - The root entity of the new popup.
 */
export function coverPopup(ctx: UiCtx, state: JsxState, over: string, coverer: Entity): void {
  const link = state.roots.get(coverer)?.popup;
  const covered = newestPopup(state, over, coverer);

  if (link === undefined || covered === undefined) {
    ctx.log.warn("ui:popup-over-missing", { over });

    return;
  }

  link.over = covered.entity;
  setCovered(ctx, covered, true);
}

/**
 * Marks the effect of a popup root as ended. The root stays mounted: the reconcile decides when it
 * leaves. A signal of a handler that no longer owns the root changes nothing.
 *
 * @param ctx - Domain context of the ui plugin.
 * @param state - The jsx state.
 * @param entity - The popup root entity.
 * @param link - The popup side of the handler whose signal aborted.
 */
export function releasePopup(ctx: UiCtx, state: JsxState, entity: Entity, link: PopupLink): void {
  if (state.roots.get(entity)?.popup !== link) return;

  link.released = true;
  ctx.deps.time.wake();
}

/**
 * Tells whether a popup that lives lies over a root.
 *
 * @param state - The jsx state.
 * @param root - The root that may be covered.
 * @returns True while its coverer is mounted and not on its way out.
 */
function coveredByLive(state: JsxState, root: Root): boolean {
  for (const other of state.roots.values()) {
    if (other.popup?.over === root.entity && !state.removing.has(other.entity)) return true;
  }

  return false;
}

/**
 * Tells whether a root waits for the settle step: released or covered, and not leaving yet.
 *
 * @param state - The jsx state.
 * @param root - A mounted root.
 * @returns True when the settle step has to look at it.
 */
function waits(state: JsxState, root: Root): boolean {
  return (root.popup?.released === true || root.covered) && !state.removing.has(root.entity);
}

/**
 * Tells whether any root waits for the settle step. Allocates nothing, so a frame without a
 * released or covered popup costs one scan.
 *
 * @param state - The jsx state.
 * @returns True when at least one root waits.
 */
function anyWaits(state: JsxState): boolean {
  for (const root of state.roots.values()) {
    if (waits(state, root)) return true;
  }

  return false;
}

/**
 * The step at the top of every reconcile: released popup roots leave once the flow rests, the
 * newest first, so a coverer goes before the popup beneath it; a covered root waits for its
 * coverer; a covered root whose coverer is gone and whose own effect still runs is uncovered.
 *
 * @param ctx - Domain context of the ui plugin.
 * @param state - The jsx state.
 * @param unmount - Starts the exit of a root.
 */
export function settlePopups(ctx: UiCtx, state: JsxState, unmount: (entity: Entity) => void): void {
  if (!anyWaits(state)) return;

  const waiting = [...state.roots.values()].filter(root => waits(state, root));
  const rests = flowRests(ctx.deps.flow.state());

  waiting.sort((first, second) => second.order - first.order);

  for (const root of waiting) {
    if (coveredByLive(state, root)) continue;

    if (root.popup?.released !== true) setCovered(ctx, root, false);
    else if (rests) unmount(root.entity);
  }
}
