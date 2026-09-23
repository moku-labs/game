/**
 * @file renderer plugin — state factory.
 */
import { createHostState } from "./host/state";
import { createSyncState } from "./sync/state";
import type { Config, State } from "./types";
import { createViewportState } from "./viewport/state";

/**
 * Creates the initial renderer state: one branch per module, composed from the module state
 * factories. Nothing is created here; `onStart` fills it when a DOM and a mount exist. The debug
 * switches start from the config.
 *
 * @param ctx - Minimal context.
 * @param ctx.config - Resolved plugin config.
 * @returns The plugin state.
 */
export function createRendererState(ctx: { readonly config: Readonly<Config> }): State {
  return {
    host: createHostState(),
    viewport: createViewportState(),
    sync: createSyncState(ctx.config.debug)
  };
}
