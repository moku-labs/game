/**
 * @file assets plugin — the fixtures of the perf tests and benches. Not a test file. Each fixture builds the mock
 * plugin outside any measured window and hands back what the world calls when an element lost `Exiting`: the check
 * whether the bundles a leaving scene named may go (F51).
 */
import { alloc } from "../../../../../tests/perf/alloc";
import { releaseSceneLeft } from "../../budget";
import { createMockAssets } from "../unit/mock-assets";

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
