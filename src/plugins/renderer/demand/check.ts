/**
 * @file renderer/demand — the dev missed-mark check: reads Pixi's render-group change lists on a skipped frame, warns,
 * never decides. The one engine file that reads Pixi private fields (`Container.renderGroup`,
 * `RenderGroup.childrenToUpdate`, `childrenRenderablesToUpdate`, `renderGroupChildren`); every read is guarded by
 * its shape, so a Pixi that renames them switches the check off instead of throwing.
 */
import type { Entity } from "../../world/types";
import type { PixiContainer, RendererCtx } from "../types";
import type { DemandState } from "./types";

/** One of Pixi's change lists: its entries, and how many of them are live. */
type ChangeList = { list: readonly unknown[]; index: number };

/**
 * The deepest level inside one render group whose transform list the check reads. Pixi keys the lists by depth in an
 * object, and a `for…in` over it allocates its keys on every pass; the levels are read by number instead.
 */
const DEEPEST = 128;

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
 * Whether a render group and every group nested in it have the change lists Pixi 8 gives them. Reads, never allocates.
 *
 * @param group - The render group, or what stands in its place.
 * @returns False when one of them has no lists of Pixi's shape.
 */
function hasLists(group: unknown): group is object {
  if (typeof group !== "object" || group === null) return false;

  const depths: unknown = Reflect.get(group, "childrenToUpdate");

  if (typeof depths !== "object" || depths === null) return false;
  if (!isChangeList(Reflect.get(group, "childrenRenderablesToUpdate"))) return false;

  const nested: unknown = Reflect.get(group, "renderGroupChildren");

  if (!Array.isArray(nested)) return true;

  for (const child of nested) if (!hasLists(child)) return false;

  return true;
}

/**
 * The entity a listed node belongs to: the node itself or the nearest parent that is a view's object or top, read
 * from sync's back references. A masked container and a mask hang in their view's wrapper, so the walk meets the top.
 * The stage, the root and a layer belong to none.
 *
 * @param node - The listed node.
 * @param sync - Sync's state.
 * @returns The entity, or `undefined`.
 */
function ownerOf(node: object, sync: RendererCtx["state"]["sync"]): Entity | undefined {
  for (let at: unknown = node; typeof at === "object" && at !== null; ) {
    const entity = sync.entityOf.get(at);

    if (entity !== undefined) return entity;

    const top = sync.viewOfTop.get(at as PixiContainer);

    if (top !== undefined) return sync.entityOf.get(top.object);

    at = Reflect.get(at, "parent");
  }

  return undefined;
}

/**
 * Warns about one listed node when it belongs to a shown view nobody marked since the last drawn frame.
 *
 * @param ctx - Domain context of the renderer plugin.
 * @param state - The demand state.
 * @param shown - The shown predicate.
 * @param node - The listed node.
 */
function visit(
  ctx: RendererCtx,
  state: DemandState,
  shown: (entity: Entity) => boolean,
  node: unknown
): void {
  if (typeof node !== "object" || node === null) return;

  const entity = ownerOf(node, ctx.state.sync);

  if (entity === undefined || state.sinceDraw.has(entity) || state.check.warned.has(entity)) {
    return;
  }

  if (!shown(entity)) return;

  state.check.warned.add(entity);

  const label: unknown = Reflect.get(node, "label");

  ctx.log.warn("renderer:missed-mark", {
    entity,
    label: typeof label === "string" ? label : ""
  });
}

/**
 * Visits the live entries of one change list.
 *
 * @param ctx - Domain context of the renderer plugin.
 * @param state - The demand state.
 * @param shown - The shown predicate.
 * @param listed - The list.
 */
function visitList(
  ctx: RendererCtx,
  state: DemandState,
  shown: (entity: Entity) => boolean,
  listed: unknown
): void {
  if (!isChangeList(listed)) return;

  for (let at = 0; at < listed.index; at += 1) visit(ctx, state, shown, listed.list[at]);
}

/**
 * Visits every node Pixi listed as changed in a render group and the groups nested in it, whose shapes `hasLists`
 * checked.
 *
 * @param ctx - Domain context of the renderer plugin.
 * @param state - The demand state.
 * @param shown - The shown predicate.
 * @param group - The render group.
 */
function visitGroup(
  ctx: RendererCtx,
  state: DemandState,
  shown: (entity: Entity) => boolean,
  group: object
): void {
  const depths = Reflect.get(group, "childrenToUpdate") as Record<number, unknown>;

  for (let depth = 0; depth <= DEEPEST; depth += 1) visitList(ctx, state, shown, depths[depth]);

  visitList(ctx, state, shown, Reflect.get(group, "childrenRenderablesToUpdate"));

  const nested: unknown = Reflect.get(group, "renderGroupChildren");

  if (!Array.isArray(nested)) return;

  for (const child of nested) visitGroup(ctx, state, shown, child as object);
}

/**
 * Warns `renderer:missed-mark` once per listed, shown, unmarked view of a skipped frame: something wrote into a
 * display object the renderer never heard of. A view marked since the last drawn frame is skipped, and so is a view
 * that is not shown (Pixi lists the changes of hidden views too). Lists keep their entries across skipped frames until
 * Pixi renders, and an entity warns once per run, so one stray write warns once. The owner of a node comes from sync's
 * back references, so no map of every view is built per frame (F69), and a pass that warns nothing allocates nothing.
 *
 * @param ctx - Domain context of the renderer plugin.
 * @param state - The demand state.
 * @param stage - The stage root.
 * @param shown - The shown predicate.
 */
export function checkMissedMarks(
  ctx: RendererCtx,
  state: DemandState,
  stage: PixiContainer,
  shown: (entity: Entity) => boolean
): void {
  const group: unknown = Reflect.get(stage, "renderGroup");

  if (!hasLists(group)) {
    state.check.off = true;
    ctx.log.debug("renderer:demand-check-off", { reason: NO_LISTS });

    return;
  }

  visitGroup(ctx, state, shown, group);
}
