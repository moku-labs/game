/**
 * @file assets plugin — the fixtures of the perf tests and benches. Not a test file. Each fixture builds the mock
 * plugin outside any measured window and hands back the call it measures: what the world calls when an element lost
 * `Exiting` (whether the bundles a leaving scene named may go, F51), a view's ask for a loaded key, and the victim pick
 * of a budget pass (F184).
 */
import { alloc } from "../../../../../tests/perf/alloc";
import { lookupTexture } from "../../api";
import { pickVictim, releaseSceneLeft } from "../../budget";
import { loadBundle } from "../../tiers";
import { createMockAssets, manifestOf } from "../unit/mock-assets";

/** Calls before a window: the check reaches its optimized tier first. */
const WARM_CALLS = 30_000;

/** Calls of a window. */
const CALLS = 100_000;

/**
 * The heap bytes one call keeps: the call run until V8 optimized it, outside the window, then `alloc` over a window
 * of `CALLS`.
 *
 * @param fn - The call.
 * @returns Bytes per call.
 */
export function bytesPerCall(fn: () => void): number {
  for (let call = 0; call < WARM_CALLS; call += 1) fn();

  return alloc(fn, CALLS);
}

/**
 * The end of an exit while no scene leaves.
 *
 * @returns The call the world makes.
 */
export function exitEndNothingLeaves(): () => void {
  const mock = createMockAssets();

  return () => releaseSceneLeft(mock.assetsCtx);
}

/**
 * The end of one exit of many while a scene leaves: another element still carries `Exiting`, so nothing goes.
 *
 * @returns The call the world makes.
 */
export function exitEndStillExiting(): () => void {
  const mock = createMockAssets();

  mock.ctx.state.sceneLeaving = ["board.chains"];
  mock.ctx.state.exiting = 2;

  return () => releaseSceneLeft(mock.assetsCtx);
}

/**
 * A view's ask for a key whose bundle is loaded: the hit path of the texture provider, which `renderer` calls for
 * every view after an invalidate (F184 keeps it as it was: a touch and a map read).
 *
 * @returns The call the renderer makes.
 */
export async function lookupHit(): Promise<() => void> {
  const mock = createMockAssets({
    manifest: manifestOf({
      board: { feature: "board", tier: "scene", keys: ["board.cell", "board.bg"] }
    })
  });

  await mock.start();
  await loadBundle(mock.assetsCtx, "board", undefined, "request");

  return () => void lookupTexture(mock.assetsCtx, "board.cell");
}

/**
 * The victim pick of a budget pass over 20 loaded bundles of 3 keys each, every other one drawn by a view by its last
 * key, the oldest among them: the pick walks every record and asks `used` of each bundle older than its best so far.
 *
 * @returns The call `enforceBudget` makes once per eviction.
 */
export async function pickHalfDrawn(): Promise<() => void> {
  const names = Array.from({ length: 20 }, (_, index) => `b${index}`);
  const bundles = Object.fromEntries(
    names.map(name => [
      name,
      { feature: name, tier: "lazy", keys: [`${name}.one`, `${name}.two`, `${name}.three`] }
    ])
  );
  const mock = createMockAssets({ manifest: manifestOf(bundles) });

  await mock.start();

  for (const name of names) await loadBundle(mock.assetsCtx, name, undefined, "request");

  mock.renderer.drawn = new Set(
    names.filter((_, index) => index % 2 === 0).map(name => `${name}.three`)
  );

  return () => void pickVictim(mock.assetsCtx);
}
