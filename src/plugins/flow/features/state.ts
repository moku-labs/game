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
 * Creates the empty map of sub-feature to parent, in its own function for the same lint reason
 * as `emptyRegistry`.
 *
 * @returns An empty map of sub-feature name to the name of the feature that declares it.
 * @example
 * ```ts
 * emptyParents().size; // 0
 * ```
 */
function emptyParents(): FeaturesState["parentOf"] {
  return new Map();
}

/**
 * Creates the features module state: no feature registered, no parent known, not sealed.
 *
 * @returns A fresh features state, owned by the plugin state of `flow`.
 */
export function createFeaturesState(): FeaturesState {
  return { byName: emptyRegistry(), parentOf: emptyParents(), sealed: false };
}
