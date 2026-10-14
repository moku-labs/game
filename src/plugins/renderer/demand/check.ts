/**
 * @file renderer/demand — the dev missed-mark check: reads Pixi's render-group change lists on a skipped frame, warns,
 * never decides. The one engine file that reads Pixi private fields (`Container.renderGroup`,
 * `RenderGroup.childrenToUpdate`, `childrenRenderablesToUpdate`, `renderGroupChildren`); every read is guarded by
 * its shape, so a Pixi that renames them switches the check off instead of throwing.
 */
import type { Entity } from "../../world/types";
import type { View } from "../sync/types";
import type { PixiContainer, RendererCtx } from "../types";
import type { DemandState } from "./types";

/** One of Pixi's change lists: its entries, and how many of them are live. */
type ChangeList = { list: readonly unknown[]; index: number };

/** What the check reads of one Pixi render group. */
type ChangeGroup = {
  /** The transform changes, one list per depth inside the group. */
  depths: readonly unknown[];
  /** The view changes: a texture, a redrawn path, a new particle step. */
  renderables: ChangeList;
  /** The render groups nested in this one. */
  nested: readonly unknown[];
};

/** Why the check switched itself off, for its one debug line. */
const NO_LISTS = "Pixi's render group has no change lists";

/**
 * Tells one of Pixi's change lists from anything else.
 *
 * @param value - What the render group holds under the name.
 * @returns True for `{ list: unknown[]; index: number }`.
 */
function isChangeList(value: unknown): value is ChangeList {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray(Reflect.get(value, "list")) &&
    typeof Reflect.get(value, "index") === "number"
  );
}

/**
 * Reads the change lists of a render group, when it has the shape Pixi 8 gives it.
 *
 * @param value - The render group, or what stands in its place.
 * @returns The lists, or `undefined` when the shape is not Pixi's.
 */
function groupOf(value: unknown): ChangeGroup | undefined {
  if (typeof value !== "object" || value === null) return undefined;

  const depths: unknown = Reflect.get(value, "childrenToUpdate");
  const renderables: unknown = Reflect.get(value, "childrenRenderablesToUpdate");
  const nested: unknown = Reflect.get(value, "renderGroupChildren");

  if (typeof depths !== "object" || depths === null || !isChangeList(renderables)) {
    return undefined;
  }

  return {
    depths: Object.values(depths),
    renderables,
    nested: Array.isArray(nested) ? nested : []
  };
}

/**
 * Collects the live entries of one change list.
 *
 * @param listed - The list.
 * @param into - Where the nodes go.
 */
function collect(listed: ChangeList, into: object[]): void {
  for (let at = 0; at < listed.index; at += 1) {
    const node = listed.list[at];

    if (typeof node === "object" && node !== null) into.push(node);
  }
}

/**
 * Collects every node Pixi listed as changed in a render group and the groups nested in it.
 *
 * @param group - The render group.
 * @param into - Where the nodes go.
 * @returns False when a nested group has no lists of Pixi's shape.
 */
function listedNodes(group: ChangeGroup, into: object[]): boolean {
  for (const depth of group.depths) if (isChangeList(depth)) collect(depth, into);

  collect(group.renderables, into);

  for (const child of group.nested) {
    const nested = groupOf(child);

    if (nested === undefined || !listedNodes(nested, into)) return false;
  }

  return true;
}

/**
 * The entity behind every display object the renderer owns for it: the object, the wrapper, the masked container and
 * the mask. Built once per check, dev builds only.
 *
 * @param views - The views by entity.
 * @returns The reverse map.
 */
function ownersOf(views: ReadonlyMap<Entity, View>): Map<object, Entity> {
  const owners = new Map<object, Entity>();

  for (const [entity, view] of views) {
    owners.set(view.object, entity);
    if (view.wrapper !== undefined) owners.set(view.wrapper, entity);
    if (view.clipped !== undefined) owners.set(view.clipped, entity);
    if (view.mask !== undefined) owners.set(view.mask, entity);
  }

  return owners;
}

/**
 * The entity a listed node belongs to: the node itself or the nearest parent that is a view's object, wrapper, masked
 * container or mask. The stage, the root and a layer belong to none.
 *
 * @param node - The listed node.
 * @param owners - The reverse map of `ownersOf`.
 * @returns The entity, or `undefined`.
 */
function ownerOf(node: object, owners: ReadonlyMap<object, Entity>): Entity | undefined {
  for (let at: unknown = node; typeof at === "object" && at !== null; ) {
    const entity = owners.get(at);

    if (entity !== undefined) return entity;

    at = Reflect.get(at, "parent");
  }

  return undefined;
}

/**
 * Warns `renderer:missed-mark` once per listed, shown, unmarked view of a skipped frame: something wrote into a
 * display object the renderer never heard of. A view marked since the last drawn frame is skipped, and so is a view
 * that is not shown (Pixi lists the changes of hidden views too). Lists keep their entries across skipped frames until
 * Pixi renders, and an entity warns once per run, so one stray write warns once.
 *
 * @param ctx - Domain context of the renderer plugin.
 * @param state - The demand state.
 * @param stage - The stage root.
 * @param views - The views by entity.
 * @param shown - The shown predicate.
 */
export function checkMissedMarks(
  ctx: RendererCtx,
  state: DemandState,
  stage: PixiContainer,
  views: ReadonlyMap<Entity, View>,
  shown: (entity: Entity) => boolean
): void {
  const group = groupOf(Reflect.get(stage, "renderGroup"));
  const nodes: object[] = [];

  if (group === undefined || !listedNodes(group, nodes)) {
    state.check.off = true;
    ctx.log.debug("renderer:demand-check-off", { reason: NO_LISTS });

    return;
  }

  if (nodes.length === 0) return;

  const owners = ownersOf(views);

  for (const node of nodes) {
    const entity = ownerOf(node, owners);

    if (entity === undefined || state.sinceDraw.has(entity) || state.check.warned.has(entity)) {
      continue;
    }

    if (!shown(entity)) continue;

    state.check.warned.add(entity);

    const label: unknown = Reflect.get(node, "label");

    ctx.log.warn("renderer:missed-mark", {
      entity,
      label: typeof label === "string" ? label : ""
    });
  }
}
