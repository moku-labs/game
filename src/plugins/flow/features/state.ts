/**
 * @file flow/features — state factory.
 */
import type { FeaturesState } from "./types";

/**
 * Creates the empty feature registry. It lives in its own function because the plugin's lint
 * rule L5 refuses a collection built inside an exported declaration.
 *
 * @returns An empty map of feature name to description.
 * @example
 * ```ts
 * emptyRegistry().size; // 0
 * ```
 */
function emptyRegistry(): FeaturesState["byName"] {
  return new Map();
}

/**
 * Creates the features module state: no feature registered, not sealed.
 *
 * @returns A fresh features state, owned by the plugin state of `flow`.
 */
export function createFeaturesState(): FeaturesState {
  return { byName: emptyRegistry(), sealed: false };
}
