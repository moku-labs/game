/**
 * @file ui/jsx — the `hosts` prop: the live views of a world projection drawn inside a ui element.
 * Each reconcile gives a view without a parent the host element as its `Parent`, and takes that
 * parent back when the host leaves or stops naming the view's projection.
 */
import { Held } from "../../input/components";
import { Parent } from "../../renderer/components";
import type { Entity } from "../../world/types";
import type { UiCtx } from "../types";
import type { DescriptionNode, Element, JsxState } from "./types";

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
    if (ecs.has(view, Held) || ecs.has(view, Parent)) continue;

    ecs.add(view, Parent({ entity: host }));
    state.hosted.set(view, host);
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

  if (ecs.get(view, Parent)?.entity === host) ecs.remove(view, Parent);
}

/**
 * The hosting step of every reconcile. A view the host no longer holds falls back to its layer; a
 * live view without a parent, and not held by a drag, gets the host as its parent.
 *
 * @param ctx - Domain context of the ui plugin.
 * @param state - The jsx state.
 */
export function hostViews(ctx: UiCtx, state: JsxState): void {
  if (state.hosts.size === 0 && state.hosted.size === 0) return;

  for (const [view, host] of state.hosted) {
    if (stillHosts(ctx, state, view, host)) continue;

    state.hosted.delete(view);
    unparent(ctx, view, host);
  }

  // Only the host elements are walked, never the whole screen; a name listed twice counts once.
  for (const host of state.hosts) {
    const element = liveHost(state, host);

    if (element === undefined) continue;

    const names = hostsOf(element.node);

    for (const [index, name] of names.entries()) {
      if (names.indexOf(name) === index && ownerOf(state, name) === host) {
        parentViews(ctx, state, name, host);
      }
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
