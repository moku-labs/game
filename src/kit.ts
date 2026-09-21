/**
 * @file Game kit skeleton — `defineGame` binds the authoring helpers to the game's types,
 * `defineFeature` turns a feature description into an ordinary plugin.
 */
import type { AnyPluginInstance } from "@moku-labs/core";
import type { defineFlow } from "./plugins/flow/runner/define";
import type { DefineNode, FeatureDescription } from "./plugins/flow/types";
import type { Json } from "./plugins/model/types";

/**
 * The types of one game. `player` and `session` type the node context; `assets` and `strings`
 * are accepted now and used from later milestones.
 *
 * @example
 * ```ts
 * type Types = { player: Player; session: Session; assets: AssetKey; strings: StringTable };
 * ```
 */
export type GameTypes = {
  player: Json;
  session: Json;
  assets: string;
  strings: Record<string, unknown>;
};

/**
 * A feature is an ordinary plugin with no API of its own; `AnyPluginInstance` is the kernel's
 * widened type for plugin lists. `logicOnly` is the same plugin reduced to the V1 keys.
 *
 * @example
 * ```ts
 * createApp({ plugins: [boardFeature.logicOnly] });
 * ```
 */
export type FeaturePlugin = AnyPluginInstance & { readonly logicOnly: AnyPluginInstance };

/**
 * The helpers returned by `defineGame`. `defineNode` sees `player` and `session` with the game's
 * types; at run time they are the same functions as in `flow/runner/define.ts`.
 *
 * @example
 * ```ts
 * const kit: Kit<Types> = defineGame<Types>();
 * ```
 */
export type Kit<Types extends GameTypes> = {
  defineNode: DefineNode<{ player: Types["player"]; session: Types["session"] }>;
  defineFlow: typeof defineFlow;
  defineFeature: typeof defineFeature;
};

/**
 * Binds the authoring helpers to the types of one game. The binding is type-only.
 *
 * @throws {Error} Always, until the build implements it.
 * @example
 * ```ts
 * export const { defineNode, defineFlow, defineFeature } = defineGame<{
 *   player: Player;
 *   session: Session;
 *   assets: AssetKey;
 *   strings: StringTable;
 * }>();
 * ```
 */
export function defineGame<Types extends GameTypes>(): Kit<Types> {
  throw new Error("not implemented");
}

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
