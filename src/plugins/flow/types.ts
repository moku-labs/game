/**
 * @file flow plugin — shared types of the plugin and its modules.
 */
import type { Log } from "@moku-labs/common/browser";
import type { AnyPluginInstance, PluginCtx } from "@moku-labs/core";
import type { Require } from "../../config";
import type { DefineBundles, LoadBundles } from "../assets/types";
import type { Api as ClockApi } from "../clock/types";
import type { Events as LifecycleEvents } from "../lifecycle/types";
import type { Json, Api as ModelApi, Patch } from "../model/types";
import type { NineSliceValue, SpriteOptions, SpriteValue, sprite } from "../renderer/components";
import type { DefineScene } from "../scenes/types";
import type { Api as TimeApi } from "../time/types";
import type { ComponentType } from "../world/ecs/types";
import type { ProjectionSpec } from "../world/projection/types";
import type { FeatureDescription, FeaturesApi, FeaturesState } from "./features/types";
import type { FxApi, FxState } from "./fx/types";
import type { GateApi, GateState } from "./gate/types";
import type { InboxApi, InboxState } from "./inbox/types";
import type { defineFlow } from "./runner/define";
import type { AnyFlow, DefineNode, RunnerApi, RunnerState } from "./runner/types";

/**
 * flow plugin events.
 *
 * @example
 * ```ts
 * // A plugin that depends on flowPlugin logs every edge the player takes.
 * createPlugin("edgeLog", {
 *   depends: [flowPlugin],
 *   hooks: ctx => ({ "flow:edge": ({ node, outcome }) => ctx.log.info("edge", { node, outcome }) })
 * }); // the play button on "home" logs { node: "home", outcome: "play" }
 * ```
 */
export type Events = {
  /** An edge was taken and its state committed. */
  "flow:edge": {
    flow: string;
    node: string;
    outcome: string;
    payload: Json;
    next: string;
    patches: { doc: Patch[]; session: Patch[] };
    index: number;
    now: number;
  };
  /** The graph reached a rest node. */
  "flow:rest": { path: string; checkpoint: boolean };
  /** A node failed and the graph rolled back. */
  "flow:error": { path: string; error: unknown; rolledBackTo: string; retry: boolean };
};

/**
 * flow plugin config.
 *
 * @example
 * ```ts
 * createApp({ pluginConfigs: { flow: { mainFlow, safeNode: "home" } } });
 * ```
 */
export type Config = {
  /** The top-level flow. Required before `run()`. */
  mainFlow: AnyFlow | undefined;
  /** Path of the checkpoint entered after a failed retry. `undefined`: the main flow's `start`. */
  safeNode: string | undefined;
  /** Retries of a failed transition before going to `safeNode`. */
  retries: number;
  /** How long `onStop` waits for the active node to settle after abort, in real milliseconds. */
  settleTimeoutMs: number;
  /** Journal entries kept between checkpoints. */
  journalLimit: number;
};

/**
 * flow plugin state: one branch per module.
 */
export type State = {
  features: FeaturesState;
  fx: FxState;
  gate: GateState;
  inbox: InboxState;
  runner: RunnerState;
};

/**
 * flow plugin API, `app.flow`: the runner on the root, the other modules grouped.
 *
 * @example
 * ```ts
 * // The game starts the graph once. After that only answers and world events move it.
 * app.flow.run().catch(showFatal);
 *
 * app.flow.gate.answer({ intent: "play" }); // the play button: true when "home" rests
 * app.flow.inbox.post({ type: "purchased" }); // the shop SDK: waits for a node that lists it
 * ```
 */
export type Api = RunnerApi & { gate: GateApi; inbox: InboxApi; fx: FxApi; features: FeaturesApi };

/**
 * Resolved dependency APIs.
 */
export type Deps = { time: TimeApi; model: ModelApi; clock: ClockApi };

/**
 * What the kernel context offers before the deps are attached.
 * `emit` is one plain method overload per event on purpose: `flow` has dependencies with events,
 * and both a property-typed and a generic `emit` break the kernel's event inference when a
 * factory is passed to `createPlugin` by direct reference (`api`, `hooks`, `onInit`, `onStart`).
 */
export type KernelSlice = Omit<PluginCtx<Config, State, Events>, "emit"> & {
  emit(name: "flow:edge", payload: Events["flow:edge"]): void;
  emit(name: "flow:rest", payload: Events["flow:rest"]): void;
  emit(name: "flow:error", payload: Events["flow:error"]): void;
  readonly global: object;
  readonly log: Log.LogApi;
  readonly require: Require;
};

/**
 * Domain context shared by the modules.
 */
export type FlowCtx = KernelSlice & { readonly deps: Deps };

/**
 * Payload of the one event flow listens to.
 */
export type LifecycleChanged = LifecycleEvents["lifecycle:changed"];

/**
 * The types of one game. `player` and `session` type the node context; `assets` and `bundles`
 * are the generated key unions of the asset scanner (`string` when a game has none yet);
 * `strings` is used from V3.
 *
 * @example
 * ```ts
 * type Types = { player: Player; session: Session; assets: AssetKey; bundles: BundleKey; strings: StringTable };
 * ```
 */
export type GameTypes = {
  player: Json;
  session: Json;
  assets: string;
  bundles?: string;
  strings: Record<string, unknown>;
};

/**
 * The bundle key union of a game, `string` when the game passed none.
 *
 * @example
 * ```ts
 * type Keys = BundlesOf<{ player: {}; session: {}; assets: string; bundles: "board"; strings: {} }>; // "board"
 * ```
 */
export type BundlesOf<Types extends GameTypes> = Types extends {
  bundles: infer Keys extends string;
}
  ? Keys
  : string;

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
 * The helpers returned by `defineGame`, bound to the game's types. `defineNode` and `projection`
 * see `player` and `session`; `defineBundles` and `load` see the bundle keys; `sprite` sees the
 * asset keys. At run time they are the same functions the plugins export.
 *
 * @example
 * ```ts
 * // kit.ts of a game: bound once, imported by every node, flow and view file.
 * export const { defineNode, defineFlow, defineFeature, projection, sprite, Sprite, defineBundles, load, defineScene } =
 *   defineGame<{
 *     player: Player;
 *     session: Session;
 *     assets: AssetKey;
 *     bundles: BundleKey;
 *     strings: Record<string, unknown>;
 *   }>();
 * ```
 */
export type Kit<Types extends GameTypes> = {
  defineNode: DefineNode<{ player: Types["player"]; session: Types["session"] }>;
  defineFlow: typeof defineFlow;
  defineFeature: (name: string, description: FeatureDescription) => FeaturePlugin;
  projection: <const LayerName extends string, const LiftName extends string, Item>(
    spec: ProjectionSpec<Item, LayerName, LiftName, Types["player"], Types["session"]>
  ) => ProjectionSpec<Item, LayerName, LiftName, Types["player"], Types["session"]>;
  sprite: (
    options: Omit<SpriteOptions, "texture"> & { texture: Types["assets"] }
  ) => ReturnType<typeof sprite>;
  defineBundles: DefineBundles<BundlesOf<Types>>;
  load: LoadBundles<BundlesOf<Types>>;
  defineScene: DefineScene<Types["assets"], BundlesOf<Types>>;
  Sprite: ComponentType<Omit<SpriteValue, "texture"> & { texture: Types["assets"] }>;
  NineSlice: ComponentType<Omit<NineSliceValue, "texture"> & { texture: Types["assets"] }>;
};

export type { Contribution, FeatureDescription, FeaturesApi } from "./features/types";
export type { Descriptor, FxApi, FxHandler, GuideOptions, Hint, NodeFx } from "./fx/types";
export type { Allow, Answer, GateApi } from "./gate/types";
export type { InboxApi, WorldEvent } from "./inbox/types";
export type {
  AnyFlow,
  AnyNode,
  AnyNodeContext,
  Bookmark,
  CheckedEdges,
  DefineNode,
  Edges,
  EnterCallback,
  Exit,
  FlowDefinition,
  FlowGraph,
  FlowSpec,
  FlowState,
  GameState,
  GraphError,
  JournalEntry,
  Mapped,
  NodeContext,
  NodeDefinition,
  NodeInfo,
  NodeSpec,
  OutcomeTags,
  Result,
  RouteStep,
  RunnerApi,
  SlotNode,
  Stage,
  Target,
  TypeTag
} from "./runner/types";
