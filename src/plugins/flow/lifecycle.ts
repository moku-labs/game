/**
 * @file flow plugin — lifecycle functions skeleton.
 */
import type { Deps, KernelSlice } from "./types";

/**
 * Resolves the dependency APIs `time`, `model` and `clock` with `ctx.require`.
 *
 * @param _ctx - Kernel context of the flow plugin.
 * @throws {Error} Always, until the build implements it.
 * @example
 * ```ts
 * const { time, model, clock } = resolveDeps(ctx);
 * ```
 */
export function resolveDeps(_ctx: KernelSlice): Deps {
  throw new Error("not implemented");
}

/**
 * Connects flow to its dependencies in `onInit`: posts `elapsed` from `clock.onElapsed` into the
 * inbox, flushes effect completions and the gate hold in `time.onFrame("signals")`, and puts the
 * `schedule` handler into `state.fx.handlers`. It works on `ctx.state`: `onInit` has no access to
 * the plugin's own API.
 *
 * @param _ctx - Kernel context of the flow plugin.
 * @throws {Error} Always, until the build implements it.
 * @example
 * ```ts
 * createPlugin("flow", { onInit: connectFlow });
 * ```
 */
export function connectFlow(_ctx: KernelSlice): void {
  throw new Error("not implemented");
}

/**
 * Registers the flow disposer: on stop the active node is aborted, its settle is awaited up to
 * `settleTimeoutMs` and an open transaction is discarded. It never starts the loop.
 *
 * @param _ctx - Kernel context of the flow plugin.
 * @throws {Error} Always, until the build implements it.
 * @example
 * ```ts
 * createPlugin("flow", { onStart: registerFlowTeardown });
 * ```
 */
export function registerFlowTeardown(_ctx: KernelSlice): void {
  throw new Error("not implemented");
}
