/**
 * @file flow/fx — API factory skeleton.
 */
import type { GateInternal } from "../gate/types";
import type { FlowCtx } from "../types";
import type { FxApi, FxInternal } from "./types";

/**
 * Creates the effects gateway: `handle` registers one handler per kind, `dispatch` delivers
 * fire-and-forget, the internal `run` awaits a descriptor (through the gate when it has
 * `answers`), hints are buffered with the transaction and released after its commit, and
 * completions resolve in start order in the `signals` phase.
 *
 * @param _ctx - Domain context of the flow plugin.
 * @param _deps - Injected sibling APIs.
 * @param _deps.gate - Internal gate API: opens the gate for a descriptor with `answers`.
 * @throws {Error} Always, until the build implements it.
 * @example
 * ```ts
 * const fx = createFxApi(ctx, { gate });
 * const off = fx.handle("sfx", playSound);
 * ```
 */
export function createFxApi(_ctx: FlowCtx, _deps: { gate: GateInternal }): FxApi & FxInternal {
  throw new Error("not implemented");
}
