/**
 * @file flow/features — API factory skeleton.
 */
import type { FlowCtx } from "../types";
import type { FeaturesApi, FeaturesInternal } from "./types";

/**
 * Creates the features API: `register` from a feature plugin's `onInit` (throws after `run()`
 * and on a duplicate name), `all`, `contributions` of a slot sorted by `order`, and the internal
 * `seal`.
 *
 * @param _ctx - Domain context of the flow plugin.
 * @throws {Error} Always, until the build implements it.
 * @example
 * ```ts
 * const features = createFeaturesApi(ctx);
 * features.register("board", description);
 * ```
 */
export function createFeaturesApi(_ctx: FlowCtx): FeaturesApi & FeaturesInternal {
  throw new Error("not implemented");
}
