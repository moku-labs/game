/**
 * @file flow plugin — state factory.
 */
import { createFeaturesState } from "./features/state";
import { createFxState } from "./fx/state";
import { createGateState } from "./gate/state";
import { createInboxState } from "./inbox/state";
import { createRunnerState } from "./runner/state";
import type { Config, State } from "./types";

/**
 * Creates the initial flow state: one branch per module, composed from the module state factories.
 * Every branch gets its own collections, so two apps in one process never share a position, a
 * feature registry or an effect handler.
 *
 * @param _ctx - Minimal context. The flow state depends on nothing in it: the graph is entered by
 *   `run()`, not by the state factory.
 * @param _ctx.global - Global framework config.
 * @param _ctx.config - Resolved plugin config.
 * @returns The plugin state.
 * @example
 * ```ts
 * const state = createFlowState({ global, config });
 * ```
 */
export function createFlowState(_ctx: {
  readonly global: Readonly<Record<string, unknown>>;
  readonly config: Readonly<Config>;
}): State {
  return {
    features: createFeaturesState(),
    fx: createFxState(),
    gate: createGateState(),
    inbox: createInboxState(),
    runner: createRunnerState()
  };
}
