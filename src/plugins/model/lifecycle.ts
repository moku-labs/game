/**
 * @file model plugin — lifecycle functions skeleton.
 */
import type { ModelCtx } from "./types";

/**
 * Registers the model disposer: on stop the player provider is flushed.
 * It does not load the save; `flow.run()` awaits `store.load()`.
 *
 * @param _ctx - Domain context of the model plugin.
 * @throws {Error} Always, until the build implements it.
 * @example
 * ```ts
 * createPlugin("model", { onStart: registerModelTeardown });
 * ```
 */
export function registerModelTeardown(_ctx: ModelCtx): void {
  throw new Error("not implemented");
}
