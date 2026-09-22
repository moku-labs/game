/**
 * @file lifecycle plugin — state factory.
 */
import type { Config, State } from "./types";

/**
 * Creates the initial lifecycle state: an empty stack of pause reasons, kept in insertion
 * order without duplicates.
 *
 * @param _ctx - Minimal context.
 * @param _ctx.config - Resolved plugin config.
 * @returns A fresh state, owned by one app.
 */
export function createLifecycleState(_ctx: { readonly config: Readonly<Config> }): State {
  return { reasons: [] };
}
