/**
 * @file model plugin — state factory skeleton.
 */
import type { Config, State } from "./types";

/**
 * Creates the initial model state: one branch per module, `store` and `rng`.
 *
 * @param _ctx - Minimal context.
 * @param _ctx.global - Global framework config.
 * @param _ctx.config - Resolved plugin config.
 * @throws {Error} Always, until the build implements it.
 * @example
 * ```ts
 * const state = createModelState({ global, config });
 * ```
 */
export function createModelState(_ctx: {
  readonly global: Readonly<Record<string, unknown>>;
  readonly config: Readonly<Config>;
}): State {
  throw new Error("not implemented");
}
