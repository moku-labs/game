/**
 * @file model/rng — API factory skeleton.
 */
import type { ModelCtx } from "../types";
import type { RngApi, RngState, RngView } from "./types";

/**
 * Creates the rng API: inspection of stream state in the committed document.
 *
 * @param _ctx - Domain context of the model plugin.
 * @throws {Error} Always, until the build implements it.
 * @example
 * ```ts
 * const rng = createRngApi(ctx);
 * ```
 */
export function createRngApi(_ctx: ModelCtx): RngApi {
  throw new Error("not implemented");
}

/**
 * Creates an rng view over a plain rng branch, draft or frozen. Each draw advances the branch.
 *
 * @param _branch - Rng branch of a save document.
 * @throws {Error} Always, until the build implements it.
 * @example
 * ```ts
 * const roll = createRngView(draft.rng).stream("chest:42").int(6);
 * ```
 */
export function createRngView(_branch: RngState): RngView {
  throw new Error("not implemented");
}
