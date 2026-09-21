/**
 * @file flow plugin — event handlers skeleton.
 */
import type { KernelSlice, LifecycleChanged } from "./types";

/**
 * Creates the hook handlers. On `lifecycle:changed` with `resumed: true` the clock is poked; on
 * a `"background"` push the model flush is started and tracked in `state.runner.flushing`.
 * The handler is synchronous.
 *
 * @param _ctx - Kernel context of the flow plugin.
 * @throws {Error} Always, until the build implements it.
 * @example
 * ```ts
 * createPlugin("flow", { hooks: createHandlers });
 * ```
 */
export function createHandlers(_ctx: KernelSlice): {
  "lifecycle:changed": (payload: LifecycleChanged) => void;
} {
  throw new Error("not implemented");
}
