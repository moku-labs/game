/**
 * @file model plugin — state factory.
 */
import { createRngState } from "./rng/state";
import { createStoreState } from "./store/state";
import type { Config, State } from "./types";

/**
 * Creates the initial model state: one branch per module, `store` and `rng`.
 * The rng branch is empty on purpose — randomness lives in the save document, so a draw commits
 * and rolls back together with the transaction that drew it.
 *
 * @param ctx - Minimal context.
 * @param ctx.config - Resolved plugin config.
 * @returns The plugin state.
 */
export function createModelState(ctx: { readonly config: Readonly<Config> }): State {
  return { store: createStoreState(ctx.config), rng: createRngState() };
}
