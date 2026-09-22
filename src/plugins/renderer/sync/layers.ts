/**
 * @file renderer/sync — the layers. `scenes` declares them through `world.projection.setLayers`;
 * `sync` mirrors that list as containers under the root, in draw order, and writes the one number
 * that sorts a layer's children.
 */
import { Order } from "../../world/ecs/define";
import type { Entity, LayerSort } from "../../world/types";
import { Transform } from "../components";
import type { PixiContainer } from "../types";
import { detach } from "./pools";
import { parentOf } from "./pose";
import type { LayerEntry, SyncCtx, SyncState, View } from "./types";

/**
 * Creates the table of layer containers. Lint rule L5 refuses a collection built inside an
 * exported declaration.
 *
 * @returns An empty table.
 */
function emptyLayers(): Map<string, LayerEntry> {
  return new Map();
}

/**
 * The container of one layer.
 *
 * @param state - The sync branch of the plugin state.
 * @param name - Layer name.
 * @returns The container, or `undefined` for a name the scene does not declare.
 */
export function layerContainer(state: SyncState, name: string): PixiContainer | undefined {
  return state.layers.get(name)?.container;
}

/**
 * The sort rule of one layer.
 *
 * @param state - The sync branch of the plugin state.
 * @param name - Layer name.
 * @returns The rule, or `"none"` for an unknown layer.
 */
export function sortOf(state: SyncState, name: string): LayerSort {
  return state.layers.get(name)?.sort ?? "none";
}

/**
 * Writes `zIndex` only when the number really changed. Pixi resorts a container exactly when a
 * child's `zIndex` was written with a new value, so a still board never resorts.
 *
 * @param object - The child of a layer container.
 * @param value - The new depth.
 */
export function writeZIndex(object: PixiContainer, value: number): void {
  if (object.zIndex === value) return;

  object.zIndex = value;
}

/**
 * Writes the depth a view has under the sort rule of its layer. A parented view hangs in its
 * parent's wrapper, which sorts by `Order` whatever layer the parent is in.
 *
 * @param sctx - Domain context of the sync module.
 * @param entity - The entity.
 * @param view - Its view.
 */
export function resort(sctx: SyncCtx, entity: Entity, view: View): void {
  const state = sctx.ctx.state.sync;
  const ecs = sctx.ctx.deps.world.ecs;
  const target = view.wrapper ?? view.object;

  if (parentOf(ecs, entity) !== 0) {
    writeZIndex(target, ecs.get(entity, Order)?.value ?? 0);

    return;
  }

  const sort = sortOf(state, view.layer);

  if (sort === "none") {
    // A depth left over from a sorted layer would decide the hit-test order here.
    writeZIndex(target, 0);

    return;
  }

  if (sort === "y") {
    writeZIndex(target, ecs.get(entity, Transform)?.y ?? 0);

    return;
  }

  writeZIndex(target, ecs.get(entity, Order)?.value ?? 0);
}

/**
 * Rebuilds the layer containers when `world.projection.layers()` handed out a new list. A name
 * that stayed keeps its container and every view in it; a name that left is detached, and the
 * views that still name it are reported.
 *
 * @param sctx - Domain context of the sync module.
 * @returns True when the list was new and the containers were rebuilt.
 */
export function syncLayers(sctx: SyncCtx): boolean {
  const state = sctx.ctx.state.sync;
  const list = sctx.ctx.deps.world.projection.layers();

  if (list === state.layerList) return false;

  const root = state.root;
  const pixi = sctx.deps.host.pixi();

  if (root === undefined || pixi === undefined) return false;

  state.layerList = list;

  const next = emptyLayers();

  for (const spec of list) {
    const container = state.layers.get(spec.name)?.container ?? new pixi.Container();

    container.label = `layer:${spec.name}`;
    container.sortableChildren = spec.sort !== "none";
    next.set(spec.name, { container, sort: spec.sort });
  }

  dropLeftLayers(sctx, next);
  state.layers = next;

  for (const spec of list) {
    const container = next.get(spec.name)?.container;

    if (container !== undefined) root.addChild(container);
  }

  return true;
}

/**
 * Detaches the containers of the layers that are no longer declared and names the views that
 * were still drawn in them.
 *
 * @param sctx - Domain context of the sync module.
 * @param next - The new table of layers.
 */
function dropLeftLayers(sctx: SyncCtx, next: Map<string, LayerEntry>): void {
  const state = sctx.ctx.state.sync;
  const stranded: Entity[] = [];

  for (const [name, entry] of state.layers) {
    if (next.has(name)) continue;

    if (entry.container !== undefined) detach(entry.container);

    for (const [entity, view] of state.views) {
      if (view.layer === name) stranded.push(entity);
    }
  }

  if (stranded.length > 0) {
    sctx.ctx.log.warn("renderer: views left without a layer", { entities: stranded });
  }
}

/**
 * Detaches and forgets every layer container. Works on the state alone.
 *
 * @param state - The sync branch of the plugin state.
 */
export function clearLayers(state: SyncState): void {
  for (const entry of state.layers.values()) {
    if (entry.container !== undefined) detach(entry.container);
  }

  state.layers.clear();
  state.layerList = undefined;
}
