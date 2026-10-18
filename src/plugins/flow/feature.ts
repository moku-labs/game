/**
 * @file Flow plugin — `defineFeature` turns a feature description into an ordinary plugin, and
 * `flattenFeatures` turns a feature tree into the flat plugin list the kernel takes.
 */
import type { AnyPluginInstance } from "@moku-labs/core";
import { createPlugin } from "../../config";
import type { FeatureDescription, FeaturePlugin, FeatureTree } from "./features/types";
import { flowPlugin } from "./index";
import { defineFlow, defineNode } from "./runner/define";
import type { GameState } from "./runner/types";
import type { FlowKit } from "./types";

/** An entry of a feature list as JavaScript or a cast may pass it: the keys of a feature, maybe missing. */
type MaybeFeature = Partial<Pick<FeaturePlugin, "features" | "logicOnly">> | undefined;

/**
 * Names a feature may not take. A feature shares the namespace with plugins: the 18 engine
 * plugins, the core plugins `log` and `env`, and the kernel's reserved app methods.
 *
 * @returns The set of names `defineFeature` refuses.
 * @example
 * ```ts
 * takenNames().has("flow"); // true
 * takenNames().has("board"); // false
 * ```
 */
function takenNames(): ReadonlySet<string> {
  return new Set([
    "time",
    "lifecycle",
    "model",
    "clock",
    "debug",
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
 * uses it so a headless test composes a feature without its screen set. `features` stays, by
 * reference, so a headless registry knows the parents too.
 *
 * @param description - The full description the game wrote.
 * @returns A description with `nodes`, `flows`, `contribute` and `features` only.
 * @example
 * ```ts
 * logicKeysOf({ flows: [boardFlow], components: [cell] }); // { flows: [boardFlow] }
 * ```
 */
function logicKeysOf(description: FeatureDescription): FeatureDescription {
  const logic: FeatureDescription = {};

  if (description.nodes !== undefined) logic.nodes = description.nodes;
  if (description.flows !== undefined) logic.flows = description.flows;
  if (description.contribute !== undefined) logic.contribute = description.contribute;
  if (description.features !== undefined) logic.features = description.features;

  return logic;
}

/**
 * Builds the error of a list entry that is not a feature, in the words of `defineGameApp`.
 *
 * @param caller - Who found it: `Feature "episodes"`, or `flattenFeatures`.
 * @param path - The entry, `features[1]` or `list[0].features[2]`.
 * @returns The error.
 * @example
 * ```ts
 * notAFeature("flattenFeatures", "list[1]").message; // "[game] flattenFeatures: list[1] is not a feature.\n  Make it with defineFeature(name, description)."
 * ```
 */
function notAFeature(caller: string, path: string): Error {
  return new Error(
    `[game] ${caller}: ${path} is not a feature.\n  Make it with defineFeature(name, description).`
  );
}

/**
 * Builds the error of a parent whose sub-feature the app does not compose.
 *
 * @param parent - The feature that declares the sub-feature.
 * @param child - The sub-feature that is missing.
 * @returns The error.
 * @example
 * ```ts
 * notComposed("episodes", "ep01").message.startsWith('[game] Feature "episodes" declares the sub-feature "ep01"'); // true
 * ```
 */
function notComposed(parent: string, child: string): Error {
  return new Error(
    `[game] Feature "${parent}" declares the sub-feature "${child}", but the app does not compose it.\n  Compose the whole tree: defineGameApp does it, a raw createApp takes flattenFeatures([...]).`
  );
}

/**
 * Throws for the first entry of a `features` list that `defineFeature` did not make. The type
 * already says so; a game in JavaScript, or one that casts, is caught here.
 *
 * @param name - The feature that declares the list.
 * @param children - The declared sub-features.
 * @throws {Error} When an entry has no `logicOnly` object or no `features` list.
 */
function assertFeatures(name: string, children: readonly MaybeFeature[]): void {
  for (const [index, child] of children.entries()) {
    if (typeof child?.logicOnly !== "object" || !Array.isArray(child.features)) {
      throw notAFeature(`Feature "${name}"`, `features[${index}]`);
    }
  }
}

/**
 * Throws for a `systemsRun` outside its type. The type already says so; a game in JavaScript, or
 * a factory that passes a string through, is caught here, before the world reads it.
 *
 * @param name - The feature that declares it.
 * @param value - What the description holds under `systemsRun`.
 * @throws {Error} When the value is present and neither `"always"` nor `"active"`.
 */
function assertSystemsRun(name: string, value: unknown): void {
  if (value === undefined || value === "always" || value === "active") return;

  throw new Error(
    `[game] Feature "${name}" has systemsRun "${String(value)}".\n  Use "always" (the default) or "active".`
  );
}

/**
 * Builds the plugin of one feature: it depends on `flow`, checks in `onInit` that the app composes
 * every declared sub-feature, then registers its description, before any plugin above reads the
 * registry in `onStart`.
 *
 * @param name - Feature name, used as the plugin name.
 * @param description - What this plugin registers.
 * @param children - The declared sub-features; only their names are read.
 * @returns The plugin instance.
 * @example
 * ```ts
 * featurePluginOf("board", { flows: [boardFlow] }, []).name; // "board"
 * ```
 */
function featurePluginOf(
  name: string,
  description: FeatureDescription,
  children: readonly { readonly name: string }[]
): AnyPluginInstance {
  return createPlugin(name, {
    depends: [flowPlugin],
    /**
     * Checks the sub-features, then writes the description into the graph's registry. `has`
     * answers for the whole plugin list, so the order of parent and children does not matter.
     * `onInit` runs in plugin order, before any plugin above reads `features.all()` in its
     * `onStart`.
     *
     * @param ctx - Plugin context of this feature plugin.
     * @throws {Error} When a declared sub-feature is not composed.
     */
    onInit: ctx => {
      const missing = children.find(child => !ctx.has(child.name));

      if (missing !== undefined) throw notComposed(name, missing.name);

      ctx.require(flowPlugin).features.register(name, description);
    }
  });
}

/**
 * Turns a feature description into a plugin that registers it with `flow.features` in `onInit`.
 * Throws for a name that is reserved or already a plugin. The plugin carries `logicOnly`: the
 * same plugin built from the V1 keys of the description, for headless tests. A feature that
 * declares `features` is a parent: its `onInit` throws when one of them is not composed. The
 * plugin carries them in `features`, its `logicOnly` carries their `logicOnly`.
 * `systemsRun: "active"` runs the feature's systems only while it is active (see `SystemsRun`).
 *
 * @param name - Feature name. Shares the namespace with plugin names.
 * @param description - What the feature brings: nodes, flows, slot contributions, sub-features.
 * @returns The feature plugin, with its `logicOnly` twin.
 * @throws {Error} When the name is reserved or belongs to an engine plugin, for an entry of
 *   `features` that `defineFeature` did not make, and for a `systemsRun` that is neither
 *   `"always"` nor `"active"`.
 * @example
 * ```ts
 * // The reward popup is a feature: the main flow only declares slot("afterOrder").
 * export const rewardFeature = defineFeature("reward", {
 *   flows: [rewardFlow],
 *   contribute: { afterOrder: { flow: rewardFlow, order: 10 } }
 * });
 * // features/episodes/index.ts: a parent declares its sub-features, each a feature of its own.
 * export const episodesFeature = defineFeature("episodes", { features: [kitFeature, ep01Feature] });
 * episodesFeature.features.map(child => child.name); // ["kit", "ep01"]
 * ```
 */
export function defineFeature(name: string, description: FeatureDescription): FeaturePlugin {
  if (takenNames().has(name)) {
    throw new Error(
      `[game] Feature name "${name}" is reserved or already a plugin.\n  Choose another feature name.`
    );
  }

  assertSystemsRun(name, description.systemsRun);

  const children = Object.freeze([...(description.features ?? [])]);

  assertFeatures(name, children);

  const logicOnly = Object.assign(featurePluginOf(name, logicKeysOf(description), children), {
    features: Object.freeze(children.map(child => child.logicOnly))
  });

  return Object.assign(featurePluginOf(name, description, children), {
    features: children,
    logicOnly
  });
}

/**
 * Tells whether an entry of a feature tree carries its `features` list, as every plugin of
 * `defineFeature` does. A plain plugin, a cast object or a hole in the array does not.
 *
 * @param entry - One entry of a list `flattenFeatures` walks.
 * @returns True when the entry has a `features` array.
 * @example
 * ```ts
 * hasFeatures(undefined); // false
 * ```
 */
function hasFeatures(entry: Partial<Pick<FeatureTree, "features">> | undefined): boolean {
  return Array.isArray(entry?.features);
}

/**
 * Collects a list of trees and every sub-feature under it, depth-first, a parent first.
 *
 * @param list - Features, full or `logicOnly`.
 * @param path - Where the list is, for the error: `list`, `list[1].features`.
 * @returns The flat list.
 * @throws {Error} When an entry has no `features` list.
 */
function flattenAt(list: readonly FeatureTree[], path: string): FeatureTree[] {
  return list.flatMap((entry, index) => {
    const at = `${path}[${index}]`;

    if (!hasFeatures(entry)) throw notAFeature("flattenFeatures", at);

    return [entry, ...flattenAt(entry.features, `${at}.features`)];
  });
}

/**
 * Turns a list of features into the flat plugin list `createApp` takes: every feature followed by
 * its sub-features, depth-first, in declaration order. `defineGameApp` does it for `features` and
 * `headless.features`; a raw `createApp` calls it. A `logicOnly` tree flattens the same way. A
 * flat list comes back unchanged.
 *
 * @param list - Features as the game lists them: full plugins, or their `logicOnly`.
 * @returns A new array; the input is not touched.
 * @throws {Error} When an entry at any depth is not a feature: a cast, or a plugin that
 *   `defineFeature` did not make.
 * @example
 * ```ts
 * // A test composes the game without defineGameApp: the parent first, then its sub-features.
 * const plugins = flattenFeatures([homeFeature, episodesFeature]);
 * plugins.map(plugin => plugin.name); // ["home", "episodes", "kit", "ep01", "ep02"]
 * createApp({ plugins: [...screen, ...plugins], pluginConfigs: { flow: { mainFlow } } });
 * ```
 */
export function flattenFeatures(list: readonly FeatureTree[]): FeatureTree[] {
  return flattenAt(list, "list");
}

/**
 * Binds the flow helpers to one game's `player` and `session`. The binding is type-only: at run
 * time these are the plugin's own functions. `defineGame` spreads it into the game's kit.
 *
 * @returns `defineNode` typed with the game, plus `defineFlow` and `defineFeature`.
 * @example
 * ```ts
 * const { defineNode } = flowFor<{ player: { coins: number }; session: {} }>();
 * const home = defineNode({ rest: true, outcomes: { play: type() }, run: ({ player }) => player.coins });
 * ```
 */
export function flowFor<Game extends GameState>(): FlowKit<Game> {
  return { defineNode, defineFlow, defineFeature };
}
