/**
 * @file flow/gate — API factory skeleton.
 */
import type { FlowCtx } from "../types";
import type { GateApi, GateInternal } from "./types";

/**
 * Creates the gate API: the single entry of player answers. The gate closes before the answer is
 * handed on; an answer to a closed gate is held for one frame, first wins; `narrow` lets one
 * answer through; `pointer(true)` delays entering an `over` node.
 *
 * @param _ctx - Domain context of the flow plugin.
 * @throws {Error} Always, until the build implements it.
 * @example
 * ```ts
 * const gate = createGateApi(ctx);
 * const answer = await gate.open({ allowed: ["play", "shop"] });
 * ```
 */
export function createGateApi(_ctx: FlowCtx): GateApi & GateInternal {
  throw new Error("not implemented");
}
