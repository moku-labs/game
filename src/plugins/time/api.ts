/**
 * @file time plugin — API factory skeleton.
 */
import type { Api, Phase, TimeCtx } from "./types";

/**
 * The six frame phases, in the exact order they run every frame.
 *
 * @example
 * ```ts
 * for (const phase of PHASES) runPhase(phase);
 * ```
 */
export const PHASES: readonly Phase[] = ["input", "animate", "layout", "sync", "signals", "render"];

/**
 * Creates the time API: frame callbacks per phase, the `Time` resource, scale, pause and
 * resume, and `step` for tests and tools.
 *
 * @param _ctx - Domain context of the time plugin.
 * @throws {Error} Always, until the build implements it.
 * @example
 * ```ts
 * const api = createTimeApi(ctx);
 * const off = api.onFrame("animate", advanceTweens);
 * ```
 */
export function createTimeApi(_ctx: TimeCtx): Api {
  throw new Error("not implemented");
}
