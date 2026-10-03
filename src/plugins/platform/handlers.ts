/**
 * @file platform plugin — the one hook. `lifecycle:changed` drives keep-awake: the screen may
 * sleep while the game is paused and stays on again when it resumes.
 */
import { setAwake } from "./provider";
import { isRunning } from "./state";
import type { KernelSlice, LifecycleChanged } from "./types";

/**
 * Follows one change of the pause stack with keep-awake. Only a running plugin with a provider
 * and `keepAwake` set acts; the first push that pauses releases the screen, the pop that resumes
 * the game takes it again.
 *
 * @param ctx - Kernel context of the platform plugin.
 * @param payload - What changed on the pause stack.
 */
function followPause(ctx: KernelSlice, payload: LifecycleChanged): void {
  const provider = ctx.config.provider;

  if (provider === undefined || !ctx.config.keepAwake || !isRunning(ctx.state)) return;

  if (payload.resumed) {
    setAwake(ctx, provider, true);

    return;
  }

  if (payload.paused && payload.action === "push" && ctx.state.awake) {
    setAwake(ctx, provider, false);
  }
}

/**
 * Creates the hook handler. It reads only the config, the state and the log, all of which exist
 * when the kernel registers hooks.
 *
 * @param ctx - Kernel context of the platform plugin.
 * @returns The one hook of the plugin.
 */
export function createHandlers(ctx: KernelSlice): {
  "lifecycle:changed": (payload: LifecycleChanged) => void;
} {
  return {
    /**
     * Lets the screen sleep on a pause and keeps it on again on the resume.
     *
     * @param payload - What changed on the pause stack.
     */
    "lifecycle:changed": (payload: LifecycleChanged): void => {
      followPause(ctx, payload);
    }
  };
}
