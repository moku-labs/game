/**
 * @file Flow plugin skeleton — `defineFeature` turns a feature description into an ordinary plugin.
 */
import type { FeatureDescription, FeaturePlugin } from "./types";

/**
 * Turns a feature description into a plugin that registers it with `flow.features` in `onInit`.
 * Throws for a name that is reserved or already a plugin.
 *
 * @param _name - Feature name. Shares the namespace with plugin names.
 * @param _description - What the feature brings: nodes, flows, slot contributions.
 * @throws {Error} Always, until the build implements it.
 * @example
 * ```ts
 * export const boardFeature = defineFeature("board", {
 *   flows: [boardFlow],
 *   contribute: { afterWin: { flow: rewardFlow, order: 10 } }
 * });
 * ```
 */
export function defineFeature(_name: string, _description: FeatureDescription): FeaturePlugin {
  throw new Error("not implemented");
}
