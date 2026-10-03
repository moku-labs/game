/**
 * @file visual — the two readers of a checkpoint. Both read through the `/inspect` sources only,
 * never a plugin internal: `stateOf` the graph position and the committed model, `describeOf`
 * the ui tree and the keyed views. Entity ids and skipped components (the renderer's `Display`)
 * are dropped, so the entity numbering never enters a baseline.
 */
import { read } from "../plugins/flow/doors/read";
import { sources } from "../plugins/flow/doors/sources";
import type { Entity } from "../plugins/world/types";
import type { ReaderApp, VisualDescribe, VisualState, VisualView } from "./types";

/** Where a view sits among the projections: its projection name and its key. */
type Address = { projection: string; key: string };

/**
 * Orders two views by projection, then by key, in code unit order.
 *
 * @param left - One view.
 * @param right - The other view.
 * @returns A negative number when `left` comes first, a positive one otherwise.
 * @example
 * ```ts
 * byAddress({ projection: "hud", key: "a" }, { projection: "board", key: "z" }); // 1
 * ```
 */
function byAddress(left: Address, right: Address): number {
  if (left.projection !== right.projection) return left.projection < right.projection ? -1 : 1;

  return left.key < right.key ? -1 : 1;
}

/**
 * Turns the projection keys of the world into a lookup from entity to address.
 *
 * @param keys - What the projections source reads: projection, key, entity.
 * @returns The address of every keyed entity.
 */
function addressesOf(keys: Record<string, Record<string, Entity>>): Map<Entity, Address> {
  const addresses = new Map<Entity, Address>();

  for (const [projection, byKey] of Object.entries(keys)) {
    for (const [key, entity] of Object.entries(byKey)) addresses.set(entity, { projection, key });
  }

  return addresses;
}

/**
 * Reads the state a checkpoint saves: where the graph rests, then the committed player,
 * session and rng.
 *
 * @param app - The running app.
 * @returns `{ path, player, session, rng }`.
 */
export function stateOf(app: ReaderApp): VisualState {
  return { path: read(app, sources.position).path, ...read(app, sources.model) };
}

/**
 * Reads the screen a checkpoint saves: the ui tree, and every entity a projection names as
 * `{ projection, key, components }`, sorted by projection then key. Ui parts, rings and unkeyed
 * views appear through the tree only, or not at all.
 *
 * @param app - The running app.
 * @returns `{ ui, views }`.
 */
export function describeOf(app: ReaderApp): VisualDescribe {
  const addresses = addressesOf(read(app, sources.projections));
  const views: VisualView[] = [];

  for (const entity of read(app, sources.entities)) {
    const address = addresses.get(entity.id);

    if (address !== undefined) views.push({ ...address, components: entity.components });
  }

  return { ui: read(app, sources.ui), views: views.toSorted(byAddress) };
}
