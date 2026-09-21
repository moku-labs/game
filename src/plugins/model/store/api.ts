/**
 * @file model/store — API factory skeleton.
 */
import type { CreateRngView } from "../rng/types";
import type { ModelCtx } from "../types";
import type { StoreApi } from "./types";

/**
 * Creates the store API: load, snapshot, transactions, rest points, rollback, restore, flush.
 *
 * @param _ctx - Domain context of the model plugin.
 * @param _deps - Functions injected by the plugin index.
 * @param _deps.createRngView - Factory of an rng view over a draft or frozen rng branch.
 * @throws {Error} Always, until the build implements it.
 * @example
 * ```ts
 * const store = createStoreApi(ctx, { createRngView });
 * ```
 */
export function createStoreApi(_ctx: ModelCtx, _deps: { createRngView: CreateRngView }): StoreApi {
  throw new Error("not implemented");
}
