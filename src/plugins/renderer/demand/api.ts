/**
 * @file renderer/demand — the demand module: change marks from sync and producers, the draw decision and the oracles.
 * Pixi's change lists are never read to decide: a frame is drawn for a reason the engine knows. A dev build reads them
 * on a skipped frame only to warn about a mark the engine missed (`check.ts`); `debug.verifyFrames` compares skipped
 * frames by pixels (`verify.ts`). Both run behind inline positive guards, so a production bundle drops them.
 */
import type { Entity } from "../../world/types";
import { changeBelow, drawnThrough } from "../kept/readers";
import type { HiddenReason, View } from "../sync/types";
import type { DemandModule, HostModule, PixiContainer, RendererCtx } from "../types";
import { checkMissedMarks } from "./check";
import { ancestorsShown, isShown, unseenBy } from "./shown";
import type { DemandFrame, DemandReason, DemandState, Marks, Unseen } from "./types";
import { verifyFrame } from "./verify";

/**
 * The first whole-frame reason of the decision, in the order they were added.
 *
 * @param wholes - The whole-frame reasons of the decision.
 * @returns The first one, or `undefined` when there is none.
 */
function firstWhole(wholes: ReadonlySet<DemandReason>): DemandReason | undefined {
  return wholes.size === 0 ? undefined : wholes.values().next().value;
}

/**
 * Tells whether one entity of a mark list passes a test, walked by index: no iterator.
 *
 * @param entities - The marks.
 * @param test - The test.
 * @returns True when one passes.
 */
function someOf(entities: Marks, test: (entity: Entity) => boolean): boolean {
  for (let index = 0; index < entities.size; index += 1) {
    if (test(entities.at(index))) return true;
  }

  return false;
}

/**
 * Empties a set when it holds something. V8 gives an empty set a new table at every `clear()`, so clearing the empty
 * sets of a still screen every frame allocated about 18 MB in 20 000 frames.
 *
 * @param set - The set.
 */
function emptyOut(set: Set<unknown>): void {
  if (set.size > 0) set.clear();
}

/**
 * Empties the marks of a decision.
 *
 * @param state - The demand state.
 */
function clearMarks(state: DemandState): void {
  // per frame: the mark lists empty by a new decision number, without a new table.
  state.marked.clear();
  state.pending.clear();
  state.loose.clear();
  state.visual.clear();
  state.moved.clear();
  state.published.clear();
  emptyOut(state.wholes);
  state.counted = false;
}

/**
 * Builds the demand module. Inert while the sync root is undefined: a mark is a no-op there.
 *
 * @param ctx - Domain context of the renderer plugin.
 * @param deps - The host, the views of sync and its reader of the hidden reasons.
 * @param deps.host - The host module.
 * @param deps.views - The views by entity: `ctx.state.sync.views`, whose identity sync keeps.
 * @param deps.hiddenBy - Sync's `hiddenBy`: whether one reason hides a view (spec 26 R1.7.1).
 * @returns The demand module.
 */
export function createDemandApi(
  ctx: RendererCtx,
  deps: {
    host: HostModule;
    views: ReadonlyMap<Entity, View>;
    hiddenBy: (view: View, reason: HiddenReason) => boolean;
  }
): DemandModule {
  const state = ctx.state.demand;
  const { host, views, hiddenBy } = deps;

  /**
   * Whether the render phase decides this frame: `onDemand` is on, or the pixel oracle runs in shadow.
   *
   * @returns True when marks are judged.
   */
  const deciding = (): boolean => ctx.config.onDemand || state.verify.on;

  /**
   * The F6/F18a predicate over the views of sync.
   *
   * @param entity - The entity.
   * @returns True when its view is drawn as the frame stands.
   */
  const shown = (entity: Entity): boolean => isShown(state, host, views, entity, through);

  /**
   * Whether a node is the top or the visual of a view hidden by `"alpha"` (spec 26 R1.7.1), read from sync's state.
   *
   * @param node - A node at alpha 0 on the chain of a view.
   * @returns True when the alpha of a view the renderer writes put it there.
   */
  const alphaHidden = (node: PixiContainer): boolean => {
    const sync = ctx.state.sync;
    const entity = sync.entityOf.get(node);
    const view = sync.viewOfTop.get(node) ?? (entity === undefined ? undefined : views.get(entity));

    return view !== undefined && hiddenBy(view, "alpha");
  };

  /**
   * The padding a kept top adds when its quad draws it (P10.1), read from the kept state.
   *
   * @param node - A node whose `renderable` is false.
   * @returns The padding, or -1 when no quad draws it.
   */
  const through = (node: Parameters<typeof drawnThrough>[1]): number =>
    drawnThrough(ctx.state.kept, node);

  /**
   * The loose rule: an adapter view counts unless an ancestor hides it.
   *
   * @param entity - The entity of a loose mark.
   * @returns True when it counts.
   */
  const looseShown = (entity: Entity): boolean => ancestorsShown(host, views, entity, through);

  /**
   * Notes an entity in the record since the last drawn frame, in a dev or an agent build.
   *
   * @param entity - The marked entity.
   */
  const remember = (entity: Entity): void => {
    if (
      (typeof __MOKU_GAME_DEV__ !== "undefined" && __MOKU_GAME_DEV__) ||
      (typeof __MOKU_GAME_AGENT__ !== "undefined" && __MOKU_GAME_AGENT__)
    ) {
      state.sinceDraw.add(entity);
    }
  };

  /**
   * The mark of a write the renderer makes or is told about, before the write: judged as the view was drawn. The
   * callers note first which kind of mark it is.
   *
   * @param entity - The entity whose view is about to change.
   */
  const judge = (entity: Entity): void => {
    if (state.marked.has(entity)) return;

    const view = views.get(entity);

    // Before the write: the pictures above the view as it stands now owe a retake (it may be leaving them).
    if (view !== undefined) changeBelow(ctx.state.kept, view.wrapper ?? view.object);

    state.marked.add(entity);
    remember(entity);

    if (!deciding() || state.counted || state.wholes.size > 0) return;

    if (shown(entity)) state.counted = true;
    else state.pending.add(entity);
  };

  /**
   * Why a frame with no whole-frame reason and no counted mark is drawn, or `"none"`.
   *
   * @param wakes - `time.wakes()` now.
   * @param captureWaiting - A capture waits for a drawn frame.
   * @returns The reason.
   */
  const reasonWithout = (wakes: number, captureWaiting: boolean): DemandReason => {
    if (state.counted) return "mark";
    if (!state.drawnOnce) return "first";
    if (wakes !== state.wakes) return "wake";
    if (captureWaiting) return "capture";
    if (state.requests > 0) return "request";
    if (someOf(state.pending, shown) || someOf(state.loose, looseShown)) return "mark";

    return "none";
  };

  /**
   * The decision of the render phase: why this frame is drawn, or `"none"`.
   *
   * @param captureWaiting - A capture waits for a drawn frame.
   * @returns True when the frame is drawn.
   */
  const decide = (captureWaiting: boolean): boolean => {
    const frame = state.frame;
    let reason: DemandReason = "always";

    if (deciding()) {
      const wakes = ctx.deps.time.wakes();

      reason = firstWhole(state.wholes) ?? reasonWithout(wakes, captureWaiting);
      state.wakes = wakes;
    }

    const drawn = (!ctx.config.onDemand || reason !== "none") && host.ready();

    frame.drawn = drawn;
    frame.reason = reason;
    frame.marks = state.marked.size + state.loose.size;
    clearMarks(state);

    if (drawn) {
      state.drawnOnce = true;
      state.requests = 0;
      emptyOut(state.sinceDraw);
    }

    return drawn;
  };

  /**
   * After the frame: on a skipped frame the dev check of Pixi's lists, then the pixel oracle when it is on.
   *
   * @param drawn - True when the decision drew the frame.
   */
  const settle = (drawn: boolean): void => {
    if (!host.ready()) return;

    if (
      typeof __MOKU_GAME_DEV__ !== "undefined" &&
      __MOKU_GAME_DEV__ &&
      !drawn &&
      ctx.config.onDemand &&
      !state.check.off
    ) {
      const stage = host.stage();

      if (stage !== undefined) checkMissedMarks(ctx, state, stage, views, shown);
    }

    if (
      ((typeof __MOKU_GAME_DEV__ !== "undefined" && __MOKU_GAME_DEV__) ||
        (typeof __MOKU_GAME_AGENT__ !== "undefined" && __MOKU_GAME_AGENT__)) &&
      state.verify.on
    ) {
      verifyFrame(ctx, state, host, state.frame);

      if (state.frame.reason === "verify") emptyOut(state.sinceDraw);
    }
  };

  /**
   * The mark of a write that changes what the view draws: judged for the decision, a retake for `kept`.
   *
   * @param entity - The entity whose view is about to change.
   */
  const mark = (entity: Entity): void => {
    if (ctx.state.sync.root === undefined) return;

    state.visual.add(entity);
    judge(entity);
  };

  return {
    mark,

    markMoved: (entity: Entity): void => {
      if (ctx.state.sync.root === undefined) return;

      state.moved.add(entity);
      judge(entity);
    },

    markLoose: (entity: Entity): void => {
      if (ctx.state.sync.root === undefined) return;

      state.loose.add(entity);
      remember(entity);
    },

    whole: (reason: DemandReason): void => {
      state.wholes.add(reason);
    },

    wholes: (): ReadonlySet<DemandReason> => state.wholes,

    request: (): void => {
      state.requests += 1;
    },

    decide,

    settle,

    frame: (): Readonly<DemandFrame> => state.frame,

    shown,

    unseenBy: (entity: Entity): Unseen =>
      unseenBy(state, host, views, entity, through, alphaHidden),

    marked: (): Marks => state.marked,

    loose: (): Marks => state.loose,

    visual: (): Marks => state.visual,

    moved: (): Marks => state.moved,

    published: (): Marks => state.published,

    verifyFrames: (on: boolean): void => {
      // Inline and positive: a production `define` folds the guard, and `verify.ts` leaves the bundle.
      state.verify.on =
        on &&
        ((typeof __MOKU_GAME_DEV__ !== "undefined" && __MOKU_GAME_DEV__) ||
          (typeof __MOKU_GAME_AGENT__ !== "undefined" && __MOKU_GAME_AGENT__));
      state.verify.reference = undefined;
    },

    verifying: (): boolean => state.verify.on,

    invalidate: (entity: Entity): void => {
      if (ctx.state.sync.root === undefined || !views.has(entity)) return;

      // A write the renderer cannot see (a filter switched on or off): the render passes are counted again (Q2).
      ctx.state.sync.passesVersion += 1;
      state.published.add(entity);
      judge(entity);
    }
  };
}
