/**
 * @file flow plugin — shared types of the plugin and its modules.
 */
import type { Log } from "@moku-labs/common/browser";
import type { AnyPluginInstance, PluginCtx } from "@moku-labs/core";
import type { Require } from "../../config";
import type { Api as ClockApi } from "../clock/types";
import type { Events as LifecycleEvents } from "../lifecycle/types";
import type { Json, Api as ModelApi, Patch } from "../model/types";
import type { Api as TimeApi } from "../time/types";
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
 * hooks: { "flow:rest": ({ path, checkpoint }) => track(path, checkpoint) }
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
 *
 * @example
 * ```ts
 * const state: State = createFlowState({ global, config });
 * ```
 */
export type State = {
  features: FeaturesState;
  fx: FxState;
  gate: GateState;
  inbox: InboxState;
  runner: RunnerState;
};

/**
 * flow plugin API: the runner on the root, the other modules grouped.
 *
 * @example
 * ```ts
 * const flow: Api = ctx.require(flowPlugin);
 * flow.gate.answer({ intent: "play" });
 * ```
 */
export type Api = RunnerApi & { gate: GateApi; inbox: InboxApi; fx: FxApi; features: FeaturesApi };

/**
 * Resolved dependency APIs.
 *
 * @example
 * ```ts
 * const deps: Deps = resolveDeps(ctx);
 * deps.clock.now();
 * ```
 */
export type Deps = { time: TimeApi; model: ModelApi; clock: ClockApi };

/**
 * What the kernel context offers before the deps are attached.
 * `emit` is one plain method overload per event on purpose: `flow` has dependencies with events,
 * and both a property-typed and a generic `emit` break the kernel's event inference when a
 * factory is passed to `createPlugin` by direct reference (`api`, `hooks`, `onInit`, `onStart`).
 *
 * @example
 * ```ts
 * export function createFlowApi(ctx: KernelSlice): Api;
 * ```
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
 *
 * @example
 * ```ts
 * const flowCtx: FlowCtx = { ...ctx, deps: resolveDeps(ctx) };
 * ```
 */
export type FlowCtx = KernelSlice & { readonly deps: Deps };

/**
 * Payload of the one event flow listens to.
 *
 * @example
 * ```ts
 * const onChanged = (payload: LifecycleChanged) => payload.resumed;
 * ```
 */
export type LifecycleChanged = LifecycleEvents["lifecycle:changed"];

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
 * The flow helpers returned by `defineGame`. `defineNode` sees `player` and `session` with the
 * game's types; at run time they are the same functions the plugin exports.
 *
 * @example
 * ```ts
 * const kit: Kit<Types> = defineGame<Types>();
 * ```
 */
export type Kit<Types extends GameTypes> = {
  defineNode: DefineNode<{ player: Types["player"]; session: Types["session"] }>;
  defineFlow: typeof defineFlow;
  defineFeature: (name: string, description: FeatureDescription) => FeaturePlugin;
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
