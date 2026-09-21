/**
 * @file model plugin — lifecycle functions.
 */
import { teardown } from "../../teardown";
import type { ModelCtx } from "./types";

/**
 * Registers the model disposer: on stop the player provider is flushed, so unwritten patches
 * reach the disk. `onStop` receives only `{ global }`, so the disposer closes over `ctx.state`.
 *
 * It does not load the save: loading can fail with a user-visible error, which belongs to the
 * graph's boot, so `flow.run()` awaits `store.load()`.
 *
 * @param ctx - Domain context of the model plugin.
 * @example
 * ```ts
 * createPlugin("model", { onStart: registerModelTeardown });
 * ```
 */
export function registerModelTeardown(ctx: ModelCtx): void {
  teardown.register(ctx.global, "model", () => ctx.state.store.provider.flush());
}
