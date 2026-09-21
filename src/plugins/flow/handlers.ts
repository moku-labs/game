/**
 * @file flow plugin — event handlers.
 */
import { resolveDeps } from "./lifecycle";
import { noop } from "./runner/loop-types";
import type { KernelSlice, LifecycleChanged } from "./types";

/**
 * Reacts to a change of the pause stack: a resume pokes the clock, going to background starts a
 * flush that `onStop` awaits.
 *
 * @param ctx - Kernel context of the flow plugin.
 * @param payload - What changed: the reason, the direction and whether the game resumed.
 */
function reactToLifecycle(ctx: KernelSlice, payload: LifecycleChanged): void {
  const deps = resolveDeps(ctx);

  if (payload.resumed) deps.clock.poke();
  if (payload.action !== "push") return;
  if (payload.reason !== "background") return;

  // The store already logged a failure. The flush in the `onStop` of model reports a lasting one,
  // so this promise never rejects: nothing is left unhandled and a stop still reaches model.
  ctx.state.runner.flushing = deps.model.store.flush().catch(noop);
}

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
 */
export function createHandlers(ctx: KernelSlice): {
  "lifecycle:changed": (payload: LifecycleChanged) => void;
} {
  return {
    /**
     * Reacts to a change of the pause stack.
     *
     * @param payload - What changed: the reason, the direction and whether the game resumed.
     */
    "lifecycle:changed": (payload: LifecycleChanged): void => {
      // A throw reaches the framework `onError`, which logs it as "game: a hook failed".
      reactToLifecycle(ctx, payload);
    }
  };
}
