/**
 * @file world plugin — shared types of the plugin and its two modules.
 */
import type { Log } from "@moku-labs/common/browser";
import type { PluginCtx } from "@moku-labs/core";
import type { Require } from "../../config";
import type { Api as FlowApi } from "../flow/types";
import type { Api as ModelApi, Events as ModelEvents } from "../model/types";
import type { Api as TimeApi } from "../time/types";
import type { EcsApi, EcsInternal, EcsState } from "./ecs/types";
import type { ProjectionApi, ProjectionInternal, ProjectionState } from "./projection/types";

/**
 * world plugin events.
 *
 * @example
 * ```ts
 * // A dev build counts what one reconcile did.
 * createPlugin("reconcileLog", {
 *   depends: [worldPlugin],
 *   hooks: ctx => ({ "world:reconciled": counts => ctx.log.debug("reconciled", counts) })
 * }); // one merge logs { mode: "play", entered: 0, changed: 1, exited: 1, ... }
 * ```
 */
export type Events = {
  /** Dev only (config `reconciledEvent`). Counts of one reconcile. */
  "world:reconciled": {
    mode: "play" | "direct";
    projections: number;
    entered: number;
    changed: number;
    exited: number;
    revived: number;
    queued: number;
    hintsRouted: number;
    hintsDropped: number;
  };
};

/**
 * world plugin config.
 *
 * @example
 * ```ts
 * createApp({ pluginConfigs: { world: { settleMs: 250, reconciledEvent: true } } });
 * ```
 */
export type Config = {
  /** Duration of the built-in settle motion, in game milliseconds. */
  settleMs: number;
  /** Emit `world:reconciled` after every reconcile. Off in production; tests and the editor turn it on. */
  reconciledEvent: boolean;
};

/**
 * world plugin state: one branch per module.
 */
export type State = { ecs: EcsState; projection: ProjectionState };

/**
 * world plugin API, `app.world`, grouped by module.
 *
 * @example
 * ```ts
 * app.world.ecs.mode(); // "live"
 * app.world.projection.entityOf("board.items", "i7"); // 1048576
 * ```
 */
export type Api = { ecs: EcsApi; projection: ProjectionApi };

/**
 * Resolved dependency APIs.
 */
export type Deps = { time: TimeApi; model: ModelApi; flow: FlowApi };

/**
 * How this plugin sends its one event. The single emit site narrows the kernel's `emit` to it.
 *
 * @example
 * ```ts
 * const emit: EmitReconciled = (name, payload) => bus.send(name, payload);
 * emit("world:reconciled", { mode: "play", projections: 1, entered: 0, changed: 1, exited: 1,
 *   revived: 0, queued: 1, hintsRouted: 1, hintsDropped: 0 });
 * ```
 */
export type EmitReconciled = (
  name: "world:reconciled",
  payload: Events["world:reconciled"]
) => void;

/**
 * What the kernel context offers before the deps are attached.
 *
 * `emit` is declared as the kernel's own, unusable shape on purpose: core 1.7 leaves a plugin's
 * own event out of the context it hands the factories as soon as `depends` is declared, so
 * `MergedPluginEvents` carries the dependency events only and a world-typed `emit` here would make
 * every factory unassignable. `projection/reconcile.ts` narrows this one member to
 * `EmitReconciled`; nothing else about the context is cast.
 */
export type KernelSlice = Omit<PluginCtx<Config, State, Events>, "emit"> & {
  emit(...args: never[]): void;
  readonly global: object;
  readonly log: Log.LogApi;
  readonly require: Require;
};

/**
 * Domain context shared by the two modules.
 */
export type WorldCtx = KernelSlice & { readonly deps: Deps };

/**
 * Payload of the one event world listens to.
 */
export type ModelCommitted = ModelEvents["model:committed"];

/**
 * Both halves of the `ecs` module: what a game calls and what `projection` gets injected.
 */
export type EcsModule = EcsApi & EcsInternal;

/**
 * Both halves of the `projection` module: what a game calls and what the frame drives.
 */
export type ProjectionModule = ProjectionApi & ProjectionInternal;

export type {
  AnyComponentType,
  AnyComponentValue,
  AnySystem,
  ComponentHandle,
  ComponentType,
  ComponentValue,
  EcsApi,
  Entity,
  Mut,
  Narrowed,
  Owner,
  QueryTerm,
  QueryTuple,
  ResourceType,
  SystemContext,
  SystemDefinition,
  TagType,
  WorldMode,
  WorldPhase
} from "./ecs/types";
export type {
  AnyProjectionSpec,
  Cause,
  ChangeHook,
  Ease,
  LayerSort,
  LayerSpec,
  Motion,
  MotionHandle,
  ProjectionApi,
  ProjectionMotion,
  ProjectionSpec,
  ViewHandle
} from "./projection/types";
