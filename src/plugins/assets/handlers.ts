/**
 * @file assets plugin — event handlers.
 */
import { enforceBudget } from "./budget";
import { withDeps } from "./lifecycle";
import { startPreload } from "./preload";
import type { AssetsCtx, FlowRest, KernelSlice } from "./types";

/**
 * Creates the hook handlers. `flow:rest` is the one moment the graph stands still, so it is where
 * the memory is settled and the neighbourhood of the position is queued. The loading itself is a
 * background queue in the state and is never awaited here: an engine hook is synchronous.
 *
 * The handler builds its domain context when it first fires, not while this factory runs: the
 * kernel registers hooks before it builds the plugin APIs, so nothing is resolvable yet.
 *
 * @param ctx - Kernel context of the assets plugin.
 * @returns The one hook of the plugin.
 */
export function createHandlers(ctx: KernelSlice): {
  "flow:rest": (payload: FlowRest) => void;
} {
  let assets: AssetsCtx | undefined;

  return {
    /**
     * Settles the texture memory and rebuilds the background preload.
     *
     * @param _payload - Where the graph rests. The position itself comes from the state.
     */
    "flow:rest": (_payload: FlowRest): void => {
      assets ??= withDeps(ctx);

      if (assets.state.io === undefined) return;

      enforceBudget(assets);

      // A fast walk shows nothing and jumps on at once: preloading its neighbourhood is waste.
      if (assets.deps.flow.state().mode === "fast") return;

      startPreload(assets);
    }
  };
}
