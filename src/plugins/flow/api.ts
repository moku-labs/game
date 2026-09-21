/**
 * @file flow plugin — API factory skeleton.
 */
import type { Api, KernelSlice } from "./types";

/**
 * Creates the flow API. Resolves the dependencies with `resolveDeps`, builds the domain context,
 * creates the modules bottom-up (`features`, `fx` and `gate`, `inbox`, then `runner`), injects
 * them, spreads the runner onto the root and groups the other modules.
 *
 * @param _ctx - Kernel context of the flow plugin.
 * @throws {Error} Always, until the build implements it.
 * @example
 * ```ts
 * const flow = createFlowApi(ctx);
 * flow.gate.answer({ intent: "play" });
 * ```
 */
export function createFlowApi(_ctx: KernelSlice): Api {
  throw new Error("not implemented");
}
