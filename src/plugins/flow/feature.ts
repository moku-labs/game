/**
 * @file Flow plugin — `defineFeature` turns a feature description into an ordinary plugin.
 */
import type { AnyPluginInstance } from "@moku-labs/core";
import { createPlugin } from "../../config";
import type { FeatureDescription } from "./features/types";
import { flowPlugin } from "./index";
import type { FeaturePlugin } from "./types";

/**
 * Names a feature may not take. A feature shares the namespace with plugins: the 17 engine
 * plugins, the core plugins `log` and `env`, and the kernel's reserved app methods.
 *
 * @returns The set of names `defineFeature` refuses.
 * @example
 * ```ts
 * if (takenNames().has(name)) throw new Error("reserved");
 * ```
 */
function takenNames(): ReadonlySet<string> {
  return new Set([
    "time",
    "lifecycle",
    "model",
    "clock",
    "flow",
    "world",
    "renderer",
    "input",
    "assets",
    "scenes",
    "anim",
    "i18n",
    "text",
    "ui",
    "effects",
    "audio",
    "platform",
    "log",
    "env",
    "start",
    "stop",
    "emit",
    "require",
    "has",
    "config",
    "global",
    "state",
    "__proto__",
    "constructor",
    "prototype"
  ]);
}

/**
 * Keeps the V1 keys of a description and drops everything a later milestone adds. `logicOnly`
 * uses it so a headless test composes a feature without its screen set.
 *
 * @param description - The full description the game wrote.
 * @returns A description with `nodes`, `flows` and `contribute` only.
 * @example
 * ```ts
 * const logic = logicKeysOf({ flows: [boardFlow], components: [cell] });
 * ```
 */
function logicKeysOf(description: FeatureDescription): FeatureDescription {
  const logic: FeatureDescription = {};

  if (description.nodes !== undefined) logic.nodes = description.nodes;
  if (description.flows !== undefined) logic.flows = description.flows;
  if (description.contribute !== undefined) logic.contribute = description.contribute;

  return logic;
}

/**
 * Builds the plugin of one feature: it depends on `flow` and registers its description in
 * `onInit`, before any plugin above reads the registry in `onStart`.
 *
 * @param name - Feature name, used as the plugin name.
 * @param description - What this plugin registers.
 * @returns The plugin instance.
 * @example
 * ```ts
 * const plugin = featurePluginOf("board", description);
 * ```
 */
function featurePluginOf(name: string, description: FeatureDescription): AnyPluginInstance {
  return createPlugin(name, {
    depends: [flowPlugin],
    /**
     * Writes the description into the graph's registry. `onInit` runs in plugin order, before any
     * plugin above reads `features.all()` in its `onStart`.
     *
     * @param ctx - Plugin context of this feature plugin.
     * @example
     * ```ts
     * createPlugin("board", { depends: [flowPlugin], onInit });
     * ```
     */
    onInit: ctx => {
      ctx.require(flowPlugin).features.register(name, description);
    }
  });
}

/**
 * Turns a feature description into a plugin that registers it with `flow.features` in `onInit`.
 * Throws for a name that is reserved or already a plugin. The plugin carries `logicOnly`: the
 * same plugin built from the V1 keys of the description, for headless tests.
 *
 * @param name - Feature name. Shares the namespace with plugin names.
 * @param description - What the feature brings: nodes, flows, slot contributions.
 * @returns The feature plugin, with its `logicOnly` twin.
 * @throws {Error} When the name is reserved or belongs to an engine plugin.
 * @example
 * ```ts
 * export const boardFeature = defineFeature("board", {
 *   flows: [boardFlow],
 *   contribute: { afterWin: { flow: rewardFlow, order: 10 } }
 * });
 * ```
 */
export function defineFeature(name: string, description: FeatureDescription): FeaturePlugin {
  if (takenNames().has(name)) {
    throw new Error(
      `[game] Feature name "${name}" is reserved or already a plugin.\n  Choose another feature name.`
    );
  }

  return Object.assign(featurePluginOf(name, description), {
    logicOnly: featurePluginOf(name, logicKeysOf(description))
  });
}
