/**
 * @file renderer plugin — state factory.
 */
import { createHostState } from "./host/state";
import { createSyncState } from "./sync/state";
import type { Config, State } from "./types";
import { createViewportState } from "./viewport/state";

/**
 * Creates the initial renderer state: one branch per module, composed from the module state
 * factories. Nothing is created here; `onStart` fills it when a DOM and a mount exist.
 *
 * @param _ctx - Minimal context. The renderer state depends on nothing in it.
 * @param _ctx.global - Global framework config.
 * @param _ctx.config - Resolved plugin config.
 * @returns The plugin state.
 */
export function createRendererState(_ctx: {
  readonly global: Readonly<Record<string, unknown>>;
  readonly config: Readonly<Config>;
}): State {
  return { host: createHostState(), viewport: createViewportState(), sync: createSyncState() };
}
