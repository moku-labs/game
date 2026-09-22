/**
 * @file world plugin — state factory.
 */
import { createEcsState } from "./ecs/state";
import { createProjectionState } from "./projection/state";
import type { Config, State } from "./types";

/**
 * Creates the initial world state: one branch per module, composed from the module state
 * factories. The world starts empty; `onStart` fills it from the feature descriptions.
 *
 * @param _ctx - Minimal context. The world state depends on nothing in it.
 * @param _ctx.global - Global framework config.
 * @param _ctx.config - Resolved plugin config.
 * @returns The plugin state.
 */
export function createWorldState(_ctx: {
  readonly global: Readonly<Record<string, unknown>>;
  readonly config: Readonly<Config>;
}): State {
  return { ecs: createEcsState(), projection: createProjectionState() };
}
