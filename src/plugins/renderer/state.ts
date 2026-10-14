/**
 * @file renderer plugin — state factory.
 */
import { createHostState } from "./host/state";
import { createMonitorState } from "./monitor/state";
import { createSyncState } from "./sync/state";
import type { Config, State } from "./types";
import { createViewportState } from "./viewport/state";

/** The fewest and the most frames the ring of the performance monitor keeps. */
const RING_FRAMES = { min: 64, max: 16_384 } as const;

/**
 * Checks the numbers of the config a game can get wrong, at `createApp`, in every build: the
 * resolution cap and the performance monitor.
 *
 * @param config - The resolved plugin config.
 * @throws {Error} When `maxResolution` is not a number above 0, `monitor.budgetMs` is neither
 *   `"rate"` nor a number above 0, or `monitor.frames` is not a whole number from 64 to 16384.
 */
function checkConfig(config: Readonly<Config>): void {
  const { maxResolution } = config;
  const { budgetMs, frames } = config.monitor;

  if (!Number.isFinite(maxResolution) || maxResolution <= 0) {
    throw new Error(`[game] renderer.maxResolution is ${maxResolution}.\n  Give a number above 0.`);
  }

  if (budgetMs !== "rate" && !(Number.isFinite(budgetMs) && budgetMs > 0)) {
    throw new Error(
      `[game] renderer.monitor.budgetMs is ${String(budgetMs)}.\n` +
        '  Give the frame budget in milliseconds, or "rate" for one frame of the current rate.'
    );
  }

  if (!Number.isInteger(frames) || frames < RING_FRAMES.min || frames > RING_FRAMES.max) {
    throw new Error(
      `[game] renderer.monitor.frames is ${frames}.\n  Give a whole number from 64 to 16384.`
    );
  }
}

/**
 * Creates the initial renderer state: one branch per module, composed from the module state
 * factories, after the config passed its checks. Nothing is created here; `onStart` fills it
 * when a DOM and a mount exist. The debug switches start from the config.
 *
 * @param ctx - Minimal context.
 * @param ctx.config - Resolved plugin config.
 * @returns The plugin state.
 * @throws {Error} When the config fails a check of `checkConfig`.
 */
export function createRendererState(ctx: { readonly config: Readonly<Config> }): State {
  checkConfig(ctx.config);

  return {
    host: createHostState(),
    viewport: createViewportState(),
    sync: createSyncState(ctx.config.debug),
    monitor: createMonitorState(ctx.config.monitor)
  };
}
