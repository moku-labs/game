/**
 * @file flow/runner — API factory skeleton.
 */
import type { FlowCtx } from "../types";
import type { Modules, RunnerApi } from "./types";

/**
 * Creates the runner API: `run` owns the one loop, `walk` and `restore` enter a position through
 * it, `describe`, `state` and `history` inspect it. Its methods are spread onto the plugin root.
 *
 * @param _ctx - Domain context of the flow plugin.
 * @param _modules - Injected sibling APIs: features, fx, gate, inbox.
 * @throws {Error} Always, until the build implements it.
 * @example
 * ```ts
 * const runner = createRunnerApi(ctx, { features, fx, gate, inbox });
 * ```
 */
export function createRunnerApi(_ctx: FlowCtx, _modules: Modules): RunnerApi {
  throw new Error("not implemented");
}
