/**
 * @file renderer — the fixture of the wrapper pool perf test and bench (hot path 2в): one wrapper of a parent view,
 * a real Pixi `Container` with its visual, leaves and comes back from the pool, as a window closes and the next one
 * opens. Not a test file.
 */
import * as pixi from "pixi.js";
import { acquire, releaseWrapper, WRAPPER_POOL } from "../../sync/pools";
import type { SyncCtx } from "../../sync/types";
import type { PixiContainer } from "../../types";

/** One trip of a wrapper, and the wrapper it ends with. */
export type WrapperTrip = { trip: () => void; wrapper: () => PixiContainer | undefined };

/**
 * The part of the sync context the pool reads: the pools, the render groups the kept cache made, the limit.
 *
 * @returns The context.
 */
function poolCtx(): SyncCtx {
  return {
    ctx: {
      state: { sync: { pools: new Map(), pooled: 0 }, kept: { madeGroups: new Set() } },
      config: { poolLimit: 1024 }
    }
  } as unknown as SyncCtx;
}

/**
 * A wrapper hung on a stage with its visual, moved and faded as a parent view leaves it, then given to the pool and
 * taken back, as `release` and `ensureWrapper` do.
 *
 * @returns The trip and the wrapper it ends with.
 */
export function pooledTrip(): WrapperTrip {
  const sctx = poolCtx();
  const stage = new pixi.Container();
  const visual = new pixi.Sprite();
  let wrapper: PixiContainer | undefined = new pixi.Container() as unknown as PixiContainer;

  return {
    trip: () => {
      if (wrapper === undefined) return;

      stage.addChild(wrapper as never);
      wrapper.addChild(visual as never);
      wrapper.position.set(12, 4);
      wrapper.alpha = 0.5;
      releaseWrapper(sctx, wrapper);
      wrapper = acquire(sctx.ctx.state.sync, WRAPPER_POOL);
    },
    wrapper: () => wrapper
  };
}

/**
 * The tree steps of a trip alone: the wrapper hung and its visual added, then both taken out again, as the pool's
 * reset does. Pixi's `addChild` and `removeChild` allocate by themselves (about 230 B a pair on Node 24), with the
 * pool or without it; the perf test takes them off the trip, so it weighs the pool's own bytes.
 *
 * @returns The tree steps.
 */
export function treeSteps(): () => void {
  const stage = new pixi.Container();
  const visual = new pixi.Sprite();
  const wrapper = new pixi.Container();

  return () => {
    stage.addChild(wrapper);
    wrapper.addChild(visual);
    visual.removeFromParent();
    wrapper.removeFromParent();
  };
}

/**
 * The same trip as before 2в: the wrapper is destroyed and a new one made.
 *
 * @returns The trip.
 */
export function destroyedTrip(): () => void {
  const stage = new pixi.Container();
  const visual = new pixi.Sprite();

  return () => {
    const wrapper = new pixi.Container();

    stage.addChild(wrapper);
    wrapper.addChild(visual);
    wrapper.position.set(12, 4);
    wrapper.alpha = 0.5;
    wrapper.removeFromParent();
    wrapper.destroy({ children: false });
  };
}
