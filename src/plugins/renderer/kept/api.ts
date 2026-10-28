/**
 * @file renderer/kept — the kept-picture module: filtered views drawn from engine-owned textures, and the range
 * pictures of overlays. A view whose filters allow it is rendered once into a picture (its subtree, the pre-pass of
 * its first filter with inputs, its filter output) and drawn as one quad beside it while nothing it depends on
 * changes, also while it moves; only the stage whose key changed is redone, in a flush before the stage pass. The
 * module reads `ctx.state.sync` (views, filters, root) directly, as `demand` does: `sync` takes it as a dependency.
 */
import type { Entity } from "../../world/types";
import { BYTES_PER_MB, roundTo } from "../monitor/units";
import type { FilterSlot, SyncWriters, View } from "../sync/types";
import type {
  DemandModule,
  HostModule,
  KeptModule,
  PixiContainer,
  PixiModule,
  RendererCtx
} from "../types";
import { flushRanges, moveRange, releaseRange, retakeRange, spriteOf, takeRange } from "./freeze";
import { drawnThrough, NOT_THROUGH, slotsPadding } from "./readers";
import {
  bypassRecord,
  createRecord,
  dropRecord,
  goLive,
  markAlphaDue,
  stepCalm,
  stepRecord
} from "./record";
import { canKeep, dropTexture, matricesOf } from "./render";
import { destroyRange } from "./state";
import type { KeptCtx, KeptMatrices, KeptRange, KeptRecord, KeptStats } from "./types";
import { drawLive, verifyPictures } from "./verify";

/**
 * The category a slot list lets the cache keep it under: the worst of its slots, `undefined` for an empty list, a
 * `"screen"` slot or a slot that names none (a game's own slot is drawn live).
 *
 * @param slots - The slots.
 * @returns `"local"`, `"placed"`, or `undefined` when no record is kept.
 */
function categoryOf(slots: readonly FilterSlot[]): "local" | "placed" | undefined {
  if (slots.length === 0) return undefined;

  let placed = false;

  for (const slot of slots) {
    if (slot.cache === undefined || slot.cache === "screen") return undefined;
    if (slot.cache === "placed") placed = true;
  }

  return placed ? "placed" : "local";
}

/**
 * The depth of a node under the stage: its count of parents.
 *
 * @param node - The node.
 * @returns The depth.
 */
function depthOf(node: PixiContainer): number {
  let depth = 0;

  for (let parent = node.parent; parent !== null; parent = parent.parent) depth += 1;

  return depth;
}

/**
 * Resets a record whose view has another top now (it got a wrapper) or left without a forget: the old one is dropped,
 * a new one made for the new top, live.
 *
 * @param kctx - The kept context.
 * @param pixi - The module that draws.
 * @param record - The record.
 * @returns True when the record was dropped.
 */
function renew(kctx: KeptCtx, pixi: PixiModule, record: KeptRecord): boolean {
  const view = kctx.ctx.state.sync.views.get(record.entity);

  if (view !== undefined && (view.wrapper ?? view.object) === record.top) return false;

  dropRecord(kctx, record, view, true);
  if (view !== undefined)
    createRecord(kctx, pixi, record.entity, view, record.slots, record.category);

  return true;
}

/**
 * Steps every record of a drawn frame, in the list's order (inner first): a record whose top changed is renewed, and
 * its new record steps later in the same loop.
 *
 * @param kctx - The kept context.
 * @param pixi - The module that draws.
 * @param matrices - The scratch matrices.
 */
function stepRecords(kctx: KeptCtx, pixi: PixiModule, matrices: KeptMatrices): void {
  const { records } = kctx.state;

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];

    if (record === undefined) continue;

    if (renew(kctx, pixi, record)) {
      index -= 1;

      continue;
    }

    const view = kctx.ctx.state.sync.views.get(record.entity);

    // per drawn frame: in a calm frame a kept record that owes nothing is not stepped (E5).
    if (view !== undefined && !stepCalm(kctx, record))
      stepRecord(kctx, pixi, matrices, record, view);
  }
}

/**
 * Builds the kept module; it reads `ctx.state.sync` (views, filters, root, layers) directly.
 *
 * @param ctx - Domain context of the renderer plugin.
 * @param deps - The modules built before it, and the writers of `sync` it draws through.
 * @param deps.host - The host module.
 * @param deps.demand - The demand module.
 * @param deps.sync - The writers of `sync`.
 * @param deps.wrap - Gives a bare view its wrapper before its first take (D4): `sync.wrapForPicture`, built after.
 * @returns The kept module.
 */
export function createKeptApi(
  ctx: RendererCtx,
  deps: {
    host: HostModule;
    demand: DemandModule;
    sync: SyncWriters;
    wrap: (entity: Entity) => PixiContainer | undefined;
  }
): KeptModule {
  const state = ctx.state.kept;
  const kctx: KeptCtx = {
    ctx,
    host: deps.host,
    demand: deps.demand,
    hidden: { ctx, deps: { demand: deps.demand } },
    sync: deps.sync,
    wrap: deps.wrap,
    state,
    matrices: undefined,
    pixi: undefined
  };

  /**
   * The view of a record's entity.
   *
   * @param record - The record.
   * @returns Its view, or `undefined` when it has none.
   */
  const viewOf = (record: KeptRecord): View | undefined => ctx.state.sync.views.get(record.entity);

  /**
   * Draws an evicted or recovered record live, with its filters back on its top.
   *
   * @param record - The record.
   */
  const live = (record: KeptRecord): void => {
    goLive(kctx, record, viewOf(record), true);
  };

  /**
   * Draws every kept record live, or its picture again, for an extract (P13).
   *
   * @param on - True to draw them live.
   */
  const bypass = (on: boolean): void => {
    if (state.bypassed === on) return;

    state.bypassed = on;

    for (let index = 0; index < state.records.length; index += 1) {
      const record = state.records[index];
      const view = record === undefined ? undefined : viewOf(record);

      if (record?.mode === "kept" && view !== undefined) bypassRecord(kctx, record, view, on);
    }
  };

  /**
   * Sorts the records deepest first when a depth changed, so an inner picture is rendered before the outer one that
   * draws its quad (P5.2). Stable: equal depths keep their order.
   */
  const sortRecords = (): void => {
    let changed = state.unsorted;

    // per drawn frame: the records walked by index, as every walk of them.
    for (let index = 0; index < state.records.length; index += 1) {
      const record = state.records[index];

      if (record === undefined) continue;

      const depth = depthOf(record.top);

      if (depth !== record.depth) {
        record.depth = depth;
        changed = true;
      }
    }

    if (changed) state.records.sort((left, right) => right.depth - left.depth);

    state.unsorted = false;
  };

  /**
   * Notes a mark on a node and every record above it (P10.3): the record of the marked entity by the mark's kind, any
   * record above it in the tree as a change of its picture.
   *
   * @param entity - The marked entity.
   */
  const collectOne = (entity: Entity): void => {
    const view = ctx.state.sync.views.get(entity);

    if (view === undefined) return;

    const top = view.wrapper ?? view.object;
    const own = state.byTop.get(top);

    if (own !== undefined) {
      const demand = deps.demand;

      if (demand.visual().has(entity) || demand.loose().has(entity)) own.dirtyS1 = true;

      if (demand.published().has(entity)) {
        own.dirtyS3 = true;
        if (view.kind === "Display" || view.kind === "adapter") own.dirtyS1 = true;
      }
    }

    for (let node = top.parent; node !== null; node = node.parent) {
      const above = state.byTop.get(node);

      if (above !== undefined) above.dirtyS1 = true;
    }
  };

  return {
    slots: (entity: Entity, slots: readonly FilterSlot[]): void => {
      const record = state.byEntity.get(entity);
      const category = categoryOf(slots);
      const view = ctx.state.sync.views.get(entity);
      const pixi = deps.host.pixi();

      if (category === undefined || view === undefined || !canKeep(pixi)) {
        if (record !== undefined) dropRecord(kctx, record, view, true);

        return;
      }

      if (record === undefined) {
        createRecord(kctx, pixi, entity, view, slots, category);

        return;
      }

      if (slotsPadding(slots) !== slotsPadding(record.slots)) record.dirtyS1 = true;

      record.slots = slots;
      record.category = category;
      record.dirtyS3 = true;
    },

    filterTarget: (view: View): PixiContainer => {
      const top = view.wrapper ?? view.object;
      const record = state.byTop.get(top);

      return record?.mode === "kept" && !state.bypassed && record.standIn !== undefined
        ? record.standIn
        : top;
    },

    forget: (entity: Entity): void => {
      const record = state.byEntity.get(entity);

      if (record !== undefined) dropRecord(kctx, record, viewOf(record), false);
    },

    collect: (): void => {
      state.frameTakes = 0;

      if (state.records.length === 0) return;

      const wholes = deps.demand.wholes();

      if (wholes.has("debug") || wholes.has("restore")) {
        for (const record of state.records) record.dirtyS1 = true;
      }

      const marked = deps.demand.marked();
      const loose = deps.demand.loose();

      // No mark and no whole-frame reason: nothing a kept picture reads changed in this frame (E5).
      state.calm = wholes.size === 0 && marked.size === 0 && loose.size === 0;

      // per frame: the marks walked by index, no iterator.
      for (let index = 0; index < marked.size; index += 1) collectOne(marked.at(index));
      for (let index = 0; index < loose.size; index += 1) collectOne(loose.at(index));
    },

    flush: (): void => {
      const pixi = deps.host.pixi();
      const matrices = matricesOf(kctx);

      state.flushPasses = 0;
      state.drawnPictures = 0;

      if (!canKeep(pixi) || matrices === undefined) return;

      state.frame += 1;

      if (state.on) {
        sortRecords();
        state.firstTakes = 0;
        markAlphaDue(kctx, pixi);
        stepRecords(kctx, pixi, matrices);
        // A flush that no collect went before steps every record.
        state.calm = false;
      } else {
        for (const record of state.records) if (record.mode === "kept") live(record);
      }

      flushRanges(kctx);
    },

    after: (): void => {
      // The overdraw heat map is no picture of the game: its frames are not compared.
      if (
        ((typeof __MOKU_GAME_DEV__ !== "undefined" && __MOKU_GAME_DEV__) ||
          (typeof __MOKU_GAME_AGENT__ !== "undefined" && __MOKU_GAME_AGENT__)) &&
        deps.demand.verifying() &&
        !ctx.state.sync.debug.overdraw
      ) {
        verifyPictures(kctx, bypass, () => {
          for (const record of state.records) if (record.mode === "kept") live(record);
        });
      }
    },

    shownThrough: (node: PixiContainer): boolean => drawnThrough(state, node) !== NOT_THROUGH,

    padOf: (node: PixiContainer): number => {
      const record = state.byTop.get(node);

      return record === undefined ? 0 : slotsPadding(record.slots);
    },

    take: (range: KeptRange): boolean => takeRange(kctx, range, live),

    retake: (id: Entity): void => retakeRange(kctx, id),

    move: (id: Entity, slot: KeptRange["slot"]): void => moveRange(kctx, id, slot),

    release: (id: Entity): void => releaseRange(kctx, id),

    kept: (id: Entity): boolean => state.ranges.get(id)?.picture !== undefined,

    sprite: (id: Entity): PixiContainer | undefined => spriteOf(kctx, id),

    stats: (): KeptStats => ({
      pictures: state.drawnPictures,
      mb: roundTo(state.bytes / BYTES_PER_MB, 2),
      retakes: state.takesWindow
    }),

    drainTakes: (): number => {
      const takes = state.takesOpen;

      state.takesWindow = takes;
      state.takesOpen = 0;

      return takes;
    },

    drainRefreshes: (): number => {
      const refreshes = state.refreshesOpen;

      state.refreshesOpen = 0;

      return refreshes;
    },

    bypass,

    live: <Result>(draw: () => Result): Result => {
      // Inline and positive: a production `define` folds the guard, and `verify.ts` leaves the bundle.
      if (
        (typeof __MOKU_GAME_DEV__ !== "undefined" && __MOKU_GAME_DEV__) ||
        (typeof __MOKU_GAME_AGENT__ !== "undefined" && __MOKU_GAME_AGENT__)
      ) {
        return drawLive(kctx, bypass, draw);
      }

      return draw();
    },

    enabled: (on: boolean): void => {
      const next = on && state.allowed;

      if (next === state.on) return;

      state.on = next;
      // The next drawn frame draws every view live, or lets them be taken again: one is drawn.
      deps.demand.whole("debug");
    },

    isOn: (): boolean => state.on,

    reset: (): void => {
      for (let record = state.records[0]; record !== undefined; record = state.records[0]) {
        dropRecord(kctx, record, viewOf(record), true);
      }
      for (const range of state.ranges.values()) {
        destroyRange(range, texture => dropTexture(kctx, texture));
      }

      state.ranges.clear();

      if (state.spare !== undefined) {
        dropTexture(kctx, state.spare);
        state.spare = undefined;
      }

      state.bytes = 0;
      state.drawnPictures = 0;
    }
  };
}
