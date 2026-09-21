/**
 * @file flow plugin — event handlers.
 */
import { resolveDeps } from "./lifecycle";
import type { KernelSlice, LifecycleChanged } from "./types";

/**
 * Creates the hook handlers. On `lifecycle:changed` with `resumed: true` the clock is poked, so
 * the time that passed in the background arrives as one `elapsed`; on a `"background"` push the
 * model flush is started and tracked in `state.runner.flushing`, which `onStop` awaits.
 *
 * The handler is synchronous — every engine hook is — and it resolves its dependencies when it
 * fires: the kernel registers hooks before it builds the plugin APIs, so nothing is resolvable
 * while this factory runs.
 *
 * @param ctx - Kernel context of the flow plugin.
 * @returns The one hook of the plugin.
 * @example
 * ```ts
 * createPlugin("flow", { hooks: createHandlers });
 * ```
 */
export function createHandlers(ctx: KernelSlice): {
  "lifecycle:changed": (payload: LifecycleChanged) => void;
} {
  return {
    /**
     * Reacts to a change of the pause stack.
     *
     * @param payload - What changed: the reason, the direction and whether the game resumed.
     * @example
     * ```ts
     * handlers["lifecycle:changed"]({ reason: "background", action: "pop", ... });
     * ```
     */
    "lifecycle:changed": (payload: LifecycleChanged): void => {
      const deps = resolveDeps(ctx);

      if (payload.resumed) deps.clock.poke();
      if (payload.action !== "push") return;
      if (payload.reason !== "background") return;

      ctx.state.runner.flushing = deps.model.store.flush();
    }
  };
}
