/**
 * @file flow plugin — state factory skeleton.
 */
import type { Config, State } from "./types";

/**
 * Creates the initial flow state: one branch per module, composed from the module state factories.
 *
 * @param _ctx - Minimal context.
 * @param _ctx.global - Global framework config.
 * @param _ctx.config - Resolved plugin config.
 * @throws {Error} Always, until the build implements it.
 * @example
 * ```ts
 * const state = createFlowState({ global, config });
 * ```
 */
export function createFlowState(_ctx: {
  readonly global: Readonly<Record<string, unknown>>;
  readonly config: Readonly<Config>;
}): State {
  throw new Error("not implemented");
}
