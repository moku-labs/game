/**
 * @file visual — the two readers of a checkpoint. Both read through the `/inspect` sources only,
 * never a plugin internal: `stateOf` the graph position and the committed model, `describeOf`
 * the ui tree and the keyed views. Entity ids and skipped components (the renderer's `Display`)
 * are dropped and a `Parent` names its entity by address, so the entity numbering never enters a
 * baseline.
 */
import { read } from "../plugins/flow/doors/read";
import { sources } from "../plugins/flow/doors/sources";
import type { Json } from "../plugins/model/types";
import type { UiNode } from "../plugins/ui/types";
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
 * Reads the entity a `Parent` component points at.
 *
 * @param parent - The JSON of the component, if the view has one.
 * @returns The parent entity, or `undefined` when there is no `Parent` of the usual shape.
 * @example
 * ```ts
 * parentOf({ entity: 1048614 }); // 1048614
 * ```
 */
function parentOf(parent: Json | undefined): Entity | undefined {
  if (typeof parent !== "object" || parent === null || Array.isArray(parent)) return undefined;

  return typeof parent.entity === "number" ? parent.entity : undefined;
}

/**
 * Names the parent of a view by its projection and key instead of its entity id, which depends
 * on the order the world spawned and freed its entities. A parent no projection names is `{}`.
 *
 * @param components - The JSON components of the view.
 * @param addresses - The address of every keyed entity.
 * @returns The components, with `Parent` as an address.
 */
function withParentAddress(
  components: Record<string, Json>,
  addresses: ReadonlyMap<Entity, Address>
): Record<string, Json> {
  const parent = parentOf(components.Parent);

  if (parent === undefined) return components;

  const address = addresses.get(parent);

  return { ...components, Parent: address === undefined ? {} : { ...address } };
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
 * The ui tree without the words of its texts, at every depth.
 *
 * @param node - A node of the ui source.
 * @returns The node and its children, none with `content`.
 */
function withoutContent(node: UiNode): UiNode {
  const copy: UiNode = { ...node, children: node.children.map(child => withoutContent(child)) };

  delete copy.content;

  return copy;
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

    if (address !== undefined) {
      views.push({ ...address, components: withParentAddress(entity.components, addresses) });
    }
  }

  // describe.json keeps rects and styles, not label text: a changed number is a state difference.
  return { ui: withoutContent(read(app, sources.ui)), views: views.toSorted(byAddress) };
}
