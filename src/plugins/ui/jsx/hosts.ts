/**
 * @file ui/jsx — the `hosts` prop: the live views of a world projection drawn inside a ui element.
 * Each reconcile gives a view without a parent the host element as its `Parent`, and takes that
 * parent back when the host leaves or stops naming the view's projection. A JSX projection a host
 * names is laid out in it instead: its root takes the host as its slot (spec 16 U3), and the
 * readers of an element's place map the rects of a slotted root into root coordinates.
 */
import { Held } from "../../input/components";
import { Parent } from "../../renderer/components";
import { rootPoseOf } from "../../renderer/sync/pose";
import type { Entity } from "../../world/types";
import type { ElementLookup, Rect } from "../layout/types";
import type { UiCtx } from "../types";
import { drawnRect, visualRectOf } from "../visual";
import type { DescriptionNode, Element, JsxState, Root } from "./types";

/** What an element that hosts nothing answers: one frozen list, never a new one. */
const NO_HOSTS: readonly string[] = Object.freeze([]);

/**
 * Tells a list of projection names from any other prop value.
 *
 * @param value - The `hosts` prop.
 * @returns True for an array of strings.
 */
function isNameList(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every(name => typeof name === "string");
}

/**
 * The projection names an element hosts. Allocates nothing: the prop itself, or one shared
 * empty list.
 *
 * @param node - The node the markup wrote.
 * @returns The names, empty when the element hosts nothing.
 * @example
 * ```ts
 * hostsOf({ type: "stack", props: { hosts: ["board.items"] }, children: [] }); // ["board.items"]
 * ```
 */
export function hostsOf(node: DescriptionNode): readonly string[] {
  const hosts = node.props.hosts;

  return isNameList(hosts) ? hosts : NO_HOSTS;
}

/**
 * Keeps the set of host elements in step with one element that entered or was patched.
 *
 * @param state - The jsx state.
 * @param element - The element.
 */
export function trackHost(state: JsxState, element: Element): void {
  if (hostsOf(element.node).length > 0) state.hosts.add(element.entity);
  else state.hosts.delete(element.entity);
}

/**
 * The element of a host entity while it hosts: mounted, live and not leaving.
 *
 * @param state - The jsx state.
 * @param host - An entity of the host set.
 * @returns The element, or `undefined` while it hosts nothing.
 */
function liveHost(state: JsxState, host: Entity): Element | undefined {
  const element = state.elements.get(host);

  return element === undefined || !element.live || state.exiting.has(host) ? undefined : element;
}

/**
 * The host that owns the views of a projection: the first live host that names it. A view
 * belongs to one projection, so the first host wins each of its views.
 *
 * @param state - The jsx state.
 * @param name - The projection name.
 * @returns The owning host, `undefined` when no live host names the projection.
 */
function ownerOf(state: JsxState, name: string): Entity | undefined {
  for (const host of state.hosts) {
    const element = liveHost(state, host);

    if (element !== undefined && hostsOf(element.node).includes(name)) return host;
  }

  return undefined;
}

/**
 * Gives the host as parent to every view of one projection that has no parent and is not held
 * by a drag. The parent is queued while the phase runs, so ownership is decided by name first.
 *
 * @param ctx - Domain context of the ui plugin.
 * @param state - The jsx state.
 * @param name - The projection the host owns.
 * @param host - The owning host.
 */
function parentViews(ctx: UiCtx, state: JsxState, name: string, host: Entity): void {
  const ecs = ctx.deps.world.ecs;

  for (const view of ctx.deps.world.projection.entitiesOf(name)) {
    if (ecs.has(view, Held)) continue;
    // A parent the full step of this frame took back is still there until the flush: the view is free (H3).
    if (ecs.has(view, Parent) && !state.released.has(view)) continue;

    ecs.add(view, Parent({ entity: host }));
    state.hosted.set(view, host);
    state.released.delete(view);
  }
}

/**
 * Tells whether a host still hosts a view: it lives, it is not leaving, and it still names the
 * projection the view belongs to. An exiting view keeps its host while its exit plays.
 *
 * @param ctx - Domain context of the ui plugin.
 * @param state - The jsx state.
 * @param view - The hosted view.
 * @param host - The element that hosts it.
 * @returns True while the parent stays.
 */
function stillHosts(ctx: UiCtx, state: JsxState, view: Entity, host: Entity): boolean {
  const element = state.elements.get(host);
  const place = ctx.deps.world.projection.keyOf(view);

  if (element === undefined || state.exiting.has(host) || place === undefined) return false;

  return hostsOf(element.node).includes(place.projection);
}

/**
 * Takes the parent back from one hosted view, when the parent is still the host.
 *
 * @param ctx - Domain context of the ui plugin.
 * @param view - The hosted view.
 * @param host - The element that hosted it.
 */
function unparent(ctx: UiCtx, view: Entity, host: Entity): void {
  const ecs = ctx.deps.world.ecs;

  if (ecs.get(view, Parent)?.entity !== host) return;

  ecs.remove(view, Parent);
  ctx.state.jsx.released.add(view);
}

/**
 * The hosting step of every reconcile. A view the host no longer holds falls back to its layer; a
 * live view without a parent, and not held by a drag, gets the host as its parent. With `only`,
 * the step of the solve: the release is left to the reconcile and only the hosts that became live
 * in this solve are walked, so their views hang under them in the frame they are first drawn and
 * one full hosting step runs per frame (spec 16 U2.1, U2.2). Ownership is decided by name as in
 * the full step: a projection an older live host owns stays with it. A view the full step of the
 * frame took back from a host that left counts as free, though its queued removal has not landed:
 * after a restore the new slot takes it in the same frame, so it is never drawn alone in its layer.
 *
 * @param ctx - Domain context of the ui plugin.
 * @param state - The jsx state.
 * @param only - The hosts to walk; every host when left out.
 */
export function hostViews(ctx: UiCtx, state: JsxState, only?: ReadonlySet<Entity>): void {
  if (state.hosts.size === 0 && state.hosted.size === 0) return;
  if (only === undefined) releaseLeft(ctx, state);

  // Only the host elements are walked, never the whole screen.
  for (const host of only ?? state.hosts) {
    const element = liveHost(state, host);

    if (element !== undefined) hostNames(ctx, state, element);
  }
}

/**
 * Takes the parent back from every hosted view its host no longer holds: the view falls back to
 * its layer. The views it took back this frame are kept, so the solve's step may host them again.
 *
 * @param ctx - Domain context of the ui plugin.
 * @param state - The jsx state.
 */
function releaseLeft(ctx: UiCtx, state: JsxState): void {
  state.released.clear();

  for (const [view, host] of state.hosted) {
    if (stillHosts(ctx, state, view, host)) continue;

    state.hosted.delete(view);
    unparent(ctx, view, host);
  }
}

/**
 * Hosts the views of every projection a live host names and owns; a name listed twice counts once.
 *
 * @param ctx - Domain context of the ui plugin.
 * @param state - The jsx state.
 * @param element - The live host.
 */
function hostNames(ctx: UiCtx, state: JsxState, element: Element): void {
  const names = hostsOf(element.node);

  for (const [index, name] of names.entries()) {
    if (names.indexOf(name) === index && ownerOf(state, name) === element.entity) {
      parentViews(ctx, state, name, element.entity);
    }
  }
}

/**
 * Gives every hosted view its layer back. The teardown calls it before the ui entities go.
 *
 * @param ctx - Domain context of the ui plugin.
 * @param state - The jsx state.
 */
export function releaseHosted(ctx: UiCtx, state: JsxState): void {
  for (const [view, host] of state.hosted) unparent(ctx, view, host);

  state.hosted.clear();
}

/**
 * The slot a host keeps: the element still exists and still names the root's projection. An
 * element that exits keeps the node it left with, so a slot that exits keeps its root until it is
 * gone: the root leaves with it.
 *
 * @param state - The jsx state.
 * @param root - The root.
 * @returns The kept slot, or `undefined` when the root has none or lost it.
 */
function keptSlot(state: JsxState, root: Root): Entity | undefined {
  const element = root.slot === undefined ? undefined : state.elements.get(root.slot);

  return element !== undefined && hostsOf(element.node).includes(root.name)
    ? element.entity
    : undefined;
}

/**
 * Tells whether a host element may take a root as its slot: it names the root's projection, it is
 * not leaving, and it is not an element of that root itself.
 *
 * @param state - The jsx state.
 * @param root - The root.
 * @param host - An entity of the host set.
 * @returns The host element, or `undefined` when it cannot take the root.
 */
export function slotFor(state: JsxState, root: Root, host: Entity): Element | undefined {
  const element = state.elements.get(host);

  if (element === undefined || state.exiting.has(host) || element.root === root.entity) {
    return undefined;
  }

  return hostsOf(element.node).includes(root.name) ? element : undefined;
}

/**
 * The host element a root is laid out in (spec 16 U3.2). A popup root never is. A root keeps its
 * slot while that element exists and still names it (also while the slot exits); otherwise the first
 * element of the host set that can take it (one that enters in this solve too) is its slot.
 *
 * @param state - The jsx state.
 * @param root - The root.
 * @returns The slot, or `undefined` for a root laid out on the viewport.
 */
export function slotOf(state: JsxState, root: Root): Entity | undefined {
  if (root.popup !== undefined) return undefined;

  const kept = keptSlot(state, root);

  if (kept !== undefined) return kept;

  for (const host of state.hosts) {
    if (slotFor(state, root, host) !== undefined) return host;
  }

  return undefined;
}

/**
 * Where an element is drawn at rest, in root coordinates: its drawn rect (`visualRectOf`), and for
 * an element of a root laid out in a slot that rect mapped through the slot's root pose. The
 * rotation is left out, as the guide does.
 *
 * @param ctx - Domain context of the ui plugin.
 * @param state - The jsx state.
 * @param element - The element to place.
 * @param lookup - How a parent entity becomes its element.
 * @returns The rect in root coordinates.
 */
export function rootRectOf(
  ctx: UiCtx,
  state: JsxState,
  element: Element,
  lookup: ElementLookup
): Rect {
  const rect = visualRectOf(element, lookup);
  const slot = state.roots.get(element.root)?.slot;

  return slot === undefined ? rect : drawnRect(rootPoseOf(ctx.deps.world.ecs, slot), rect);
}
