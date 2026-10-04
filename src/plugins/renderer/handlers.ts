/**
 * @file renderer plugin — the one hook: a pause hands the captures still waiting for a drawn frame
 * their picture, since no frame comes while the clock is paused.
 */
import type { Events as LifecycleEvents } from "../lifecycle/types";
import { timePlugin } from "../time";
import { servePaused } from "./monitor/capture";
import type { KernelSlice } from "./types";

/** Payload of the `lifecycle:changed` hook. */
type LifecycleChanged = LifecycleEvents["lifecycle:changed"];

/**
 * Creates the hook of the renderer. `time` is resolved when the hook fires, not while this factory
 * runs: the kernel registers hooks before it builds the plugin APIs.
 *
 * @param ctx - Kernel context of the renderer plugin.
 * @returns The hooks of the plugin.
 */
export function createHandlers(ctx: KernelSlice): {
  "lifecycle:changed": (payload: LifecycleChanged) => void;
} {
  return {
    /**
     * Serves the captures still waiting for a drawn frame once the game pauses. Dev builds only.
     *
     * @param payload - What changed on the pause stack.
     */
    "lifecycle:changed": (payload: LifecycleChanged): void => {
      // The dev guard is inline and positive, not `isDev()`: Bun folds it under a production
      // `define` and drops the capture code with it, as the renderer README explains. The pause is
      // the one signal a paused clock gives: no frame comes to serve the queue.
      if (typeof __MOKU_GAME_DEV__ !== "undefined" && __MOKU_GAME_DEV__ && payload.paused) {
        servePaused(ctx.state.monitor, ctx.require(timePlugin));
      }
    }
  };
}
