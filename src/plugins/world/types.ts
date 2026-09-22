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
 * What the kernel context offers before the deps are attached.
 * `emit` is one plain method overload on purpose: `world` has dependencies with events, and both a
 * property-typed and a generic `emit` break the kernel's event inference when a factory is passed
 * to `createPlugin` by direct reference (`api`, `hooks`, `onStart`).
 */
export type KernelSlice = Omit<PluginCtx<Config, State, Events>, "emit"> & {
  emit(name: "world:reconciled", payload: Events["world:reconciled"]): void;
  readonly global: object;
  readonly log: Log.LogApi;
  readonly require: Require;
};

/**
 * What the kernel really hands a factory of this plugin. Core 1.7 does not merge a plugin's own
 * event into that context once the plugin declares `depends`, so its `emit` accepts the
 * dependency events only. The factories take this shape and narrow it once, in `lifecycle.ts`.
 */
export type KernelInput = Omit<KernelSlice, "emit"> & { emit(...args: never[]): void };

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
  ComponentType,
  ComponentValue,
  EcsApi,
  Entity,
  Mut,
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
