/**
 * @file flow/features — state factory skeleton.
 */
import type { FeaturesState } from "./types";

/**
 * Creates the features module state: no feature registered, not sealed.
 *
 * @throws {Error} Always, until the build implements it.
 * @example
 * ```ts
 * const features = createFeaturesState();
 * ```
 */
export function createFeaturesState(): FeaturesState {
  throw new Error("not implemented");
}
