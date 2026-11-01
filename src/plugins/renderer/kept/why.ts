/* eslint-disable unicorn/no-null -- `null` is what the report says for no reason, no take and no view. */
/**
 * @file renderer/kept — the report of `sync.debug.why()`: every view with an enabled filter, in draw order, with the
 * numbers the step left on its record turned into names. Built when asked, in an agent build only: `kept/api.ts` calls
 * it behind an inline guard, so a production build drops the file.
 */
import type { Entity } from "../../world/types";
import type { FilterSlot, SyncState, View, WhyEntry } from "../sync/types";
import type { PixiContainer } from "../types";
import { type KeptCtx, type KeptRecord, RETAKE_WHY, WHY, WHY_LIVE } from "./types";

/**
 * Adds the entities of a subtree to a set, depth first: the order Pixi draws them in.
 *
 * @param node - The top of the subtree.
 * @param entityOf - The entity of each object of a view.
 * @param order - Where they go, each once.
 */
function collectDrawOrder(
  node: PixiContainer,
  entityOf: SyncState["entityOf"],
  order: Set<Entity>
): void {
  const entity = entityOf.get(node);

  if (entity !== undefined) order.add(entity);

  for (const child of node.children) collectDrawOrder(child, entityOf, order);
}

/**
 * The label of an entity's view now.
 *
 * @param sync - The sync state.
 * @param entity - The entity.
 * @returns The label of its display object, `null` without a view.
 */
function labelOf(sync: SyncState, entity: Entity): string | null {
  return sync.views.get(entity)?.object.label ?? null;
}

/**
 * The last take of a record, while it fell in the last closed window.
 *
 * @param kctx - The kept context.
 * @param record - The record.
 * @returns The take, or `null`.
 */
function lastTake(kctx: KeptCtx, record: KeptRecord): WhyEntry["retake"] {
  const { state } = kctx;
  const why = RETAKE_WHY[record.retakeWhy - 1];

  if (why === undefined || record.retakeAt < state.windowStart) return null;
  if (record.retakeAt > state.windowEnd) return null;

  return { why, by: labelOf(kctx.ctx.state.sync, record.retakeBy) };
}

/**
 * The entry of a view with a record. A live record no step told a reason yet, as an evicted one, waits for its next.
 *
 * @param kctx - The kept context.
 * @param record - The record.
 * @param view - The label of its view.
 * @returns The entry.
 */
function recordEntry(kctx: KeptCtx, record: KeptRecord, view: string): WhyEntry {
  const retake = lastTake(kctx, record);

  if (record.mode === "kept") {
    const mode = record.direct ? "direct" : "kept";
    const entry: WhyEntry = { view, mode, reason: null, calmIn: 0, retake };

    return record.shaded ? { ...entry, quad: true } : entry;
  }

  const why = record.why === 0 ? WHY.waiting : record.why;
  const reason = WHY_LIVE[why - 1] ?? null;

  return { view, mode: "live", reason, calmIn: record.calmIn, retake };
}

/**
 * The entry of a view the cache keeps no record of: a slot it may not keep, a filter that reads the backdrop.
 *
 * @param slots - The view's slots.
 * @param view - The label of its view.
 * @returns The entry.
 */
function slotsEntry(slots: readonly FilterSlot[], view: string): WhyEntry {
  const backdrop = slots.some(slot => slot.filter.enabled && slot.filter.blendRequired);

  return {
    view,
    mode: "live",
    reason: backdrop ? "backdrop" : "cache-false",
    calmIn: 0,
    retake: null
  };
}

/**
 * The entry of an entity, when it has a view and an enabled filter.
 *
 * @param kctx - The kept context.
 * @param entity - The entity.
 * @param view - Its view.
 * @returns The entry, or `undefined`.
 */
function entryOf(kctx: KeptCtx, entity: Entity, view: View | undefined): WhyEntry | undefined {
  const slots = kctx.ctx.state.sync.filters.get(entity);

  if (view === undefined || slots === undefined) return undefined;
  if (!slots.some(slot => slot.filter.enabled)) return undefined;

  const record = kctx.state.byEntity.get(entity);

  return record === undefined
    ? slotsEntry(slots, view.object.label)
    : recordEntry(kctx, record, view.object.label);
}

/**
 * Why every filtered view is drawn as it is, in draw order; a view outside the stage comes after those in it.
 *
 * @param kctx - The kept context.
 * @returns A fresh array, one entry per view with an enabled filter.
 */
export function whyReport(kctx: KeptCtx): WhyEntry[] {
  const sync = kctx.ctx.state.sync;
  const stage = kctx.host.stage();
  const order = new Set<Entity>();
  const entries: WhyEntry[] = [];

  if (stage !== undefined) collectDrawOrder(stage, sync.entityOf, order);

  for (const entity of sync.filters.keys()) order.add(entity);

  for (const entity of order) {
    const entry = entryOf(kctx, entity, sync.views.get(entity));

    if (entry !== undefined) entries.push(entry);
  }

  return entries;
}
