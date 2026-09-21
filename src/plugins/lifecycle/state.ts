/**
 * @file lifecycle plugin — state factory skeleton.
 */
import type { Config, State } from "./types";

/**
 * Creates the initial lifecycle state: an empty stack of pause reasons, kept in insertion
 * order without duplicates.
 *
 * @param _ctx - Minimal context.
 * @param _ctx.global - Global framework config.
 * @param _ctx.config - Resolved plugin config.
 * @throws {Error} Always, until the build implements it.
 * @example
 * ```ts
 * const state = createLifecycleState({ global, config });
 * ```
 */
export function createLifecycleState(_ctx: {
  readonly global: Readonly<Record<string, unknown>>;
  readonly config: Readonly<Config>;
}): State {
  throw new Error("not implemented");
}
