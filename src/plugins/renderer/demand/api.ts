/**
 * @file renderer/demand — the demand module: change marks from sync and producers, the draw decision and the oracles.
 * Pixi's change lists are never read to decide: a frame is drawn for a reason the engine knows. A dev build reads them
 * on a skipped frame only to warn about a mark the engine missed (`check.ts`); `debug.verifyFrames` compares skipped
 * frames by pixels (`verify.ts`). Both run behind inline positive guards, so a production bundle drops them.
 */
import type { Entity } from "../../world/types";
import type { View } from "../sync/types";
import type { DemandModule, HostModule, RendererCtx } from "../types";
import { checkMissedMarks } from "./check";
import { ancestorsShown, isShown } from "./shown";
import type { DemandFrame, DemandReason, DemandState } from "./types";
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
 * Tells whether one entity of a set passes a test. The set is walked only when it holds something, so a still screen
 * makes no iterator.
 *
 * @param entities - The entities.
 * @param test - The test.
 * @returns True when one passes.
 */
function someOf(entities: ReadonlySet<Entity>, test: (entity: Entity) => boolean): boolean {
  if (entities.size === 0) return false;

  for (const entity of entities) if (test(entity)) return true;

  return false;
}

/**
 * Empties the marks of a decision.
 *
 * @param state - The demand state.
 */
function clearMarks(state: DemandState): void {
  state.marked.clear();
  state.pending.clear();
  state.loose.clear();
  state.wholes.clear();
  state.counted = false;
}

/**
 * Builds the demand module. Inert while the sync root is undefined: a mark is a no-op there.
 *
 * @param ctx - Domain context of the renderer plugin.
 * @param deps - The host and the views of sync.
 * @param deps.host - The host module.
 * @param deps.views - The views by entity: `ctx.state.sync.views`, whose identity sync keeps.
 * @returns The demand module.
 */
export function createDemandApi(
  ctx: RendererCtx,
  deps: { host: HostModule; views: ReadonlyMap<Entity, View> }
): DemandModule {
  const state = ctx.state.demand;
  const { host, views } = deps;

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
  const shown = (entity: Entity): boolean => isShown(state, host, views, entity);

  /**
   * The loose rule: an adapter view counts unless an ancestor hides it.
   *
   * @param entity - The entity of a loose mark.
   * @returns True when it counts.
   */
  const looseShown = (entity: Entity): boolean => ancestorsShown(host, views, entity);

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
   * The mark of a write the renderer makes or is told about, before the write: judged as the view was drawn.
   *
   * @param entity - The entity whose view is about to change.
   */
  const mark = (entity: Entity): void => {
    if (ctx.state.sync.root === undefined || state.marked.has(entity)) return;

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
      state.sinceDraw.clear();
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

      if (state.frame.reason === "verify") state.sinceDraw.clear();
    }
  };

  return {
    mark,

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

    marked: (): ReadonlySet<Entity> => state.marked,

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
      if (views.has(entity)) mark(entity);
    }
  };
}
