/**
 * @file world plugin — shared types of the plugin and its two modules.
 */
import type { Log } from "@moku-labs/common/browser";
import type { PluginCtx } from "@moku-labs/core";
import type { Require } from "../../config";
import type { Api as ClockApi } from "../clock/types";
import type { Api as FlowApi } from "../flow/types";
import type { Json, Api as ModelApi, Events as ModelEvents } from "../model/types";
import type { Api as TimeApi } from "../time/types";
import type { SystemTiming } from "./ecs/systems";
import type { EcsApi, EcsInternal, EcsState, Entity, Owner } from "./ecs/types";
import type {
  ProjectionApi,
  ProjectionInternal,
  ProjectionKey,
  ProjectionState
} from "./projection/types";

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
export type Api = {
  /** The ECS module: entities, components, systems, resources. */
  ecs: EcsApi;
  /** The projection module: model state to entities. */
  projection: ProjectionApi;
  /**
   * Time each world system took in the current frame, in an agent build: names by registration index and ms in the
   * same order, written while the systems run and zeroed at the start of the next frame. `undefined` without the agent
   * flag. The renderer's monitor reads it after the frame; read it, never write it.
   *
   * A live view, not a copy: the table is the world's own, the same object every call, and the next frame zeroes and
   * rewrites `ms` in place. The monitor reads it every frame of an agent build without allocating, which a copy would
   * break. `names` is replaced by a new array when a system of a new name registers, and only then: a reader that kept
   * the array tells a new system by `names !== kept`. A caller that keeps numbers past the frame copies them (`[...systems.ms]`); a write into it changes what the
   * monitor logs.
   *
   * @returns The live timing table, or `undefined`.
   * @example
   * ```ts
   * // The renderer's monitor, at the end of a frame of a debug build:
   * const systems = ctx.require(worldPlugin).systemTimes();
   * systems?.names[3]; // "ward.pan"
   * systems?.ms[3]; // 0.42
   * ```
   */
  systemTimes(): Readonly<SystemTiming> | undefined;
};

/**
 * Resolved dependency APIs.
 */
export type Deps = { time: TimeApi; model: ModelApi; flow: FlowApi; clock: ClockApi };

/**
 * What the kernel context offers before the deps are attached.
 *
 * `index.ts` writes `events` with an annotated `register` (core spec `14-EVENT-REGISTRATION.md`
 * row 8), so the own event reaches the context the kernel hands the factories and `emit` is the
 * kernel's own, world-typed one. No member of the context is cast.
 */
export type KernelSlice = PluginCtx<Config, State, Events> & {
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
 * One entity in full, as the `/inspect` source `game.explain` reads it: its row of
 * `ecs.snapshot()`, its projection key and the components a motion still drives.
 *
 * @example
 * ```ts
 * const sliding: Explained = {
 *   id: 1_048_577,
 *   owner: { kind: "projection", name: "board.items" },
 *   key: { projection: "board.items", key: "i7" },
 *   components: { Layer: { name: "items" } },
 *   skipped: ["Display"],
 *   motions: ["Transform"]
 * };
 * ```
 */
export type Explained = {
  id: Entity;
  owner: Owner;
  /** `projection.keyOf`: the view address, also for an element registered under a key. */
  key: ProjectionKey | undefined;
  /** The JSON components, as `EntitySnapshot.components`. */
  components: Record<string, Json>;
  /** The names of the components that are not JSON, as `EntitySnapshot.skipped`. */
  skipped: string[];
  /** `projection.motionsOf`: the components a running track drives, in start order. */
  motions: readonly string[];
};

/**
 * Both halves of the `ecs` module: what a game calls and what `projection` gets injected.
 */
export type EcsModule = EcsApi & EcsInternal;

/**
 * Both halves of the `projection` module: what a game calls and what the frame drives.
 */
export type ProjectionModule = ProjectionApi & ProjectionInternal;

export type { SystemTiming } from "./ecs/systems";
export type {
  AnyComponentType,
  AnyComponentValue,
  AnySystem,
  ComponentHandle,
  ComponentSchema,
  ComponentType,
  ComponentValue,
  EcsApi,
  Entity,
  EntityDiff,
  EntitySnapshot,
  FrameDiff,
  GameSystemDefinition,
  Mut,
  Narrowed,
  Owner,
  QueryTerm,
  QueryTuple,
  ResourceType,
  SystemContext,
  SystemContextOf,
  SystemDefinition,
  SystemFor,
  TagType,
  WorldMode,
  WorldPhase,
  WorldSnapshot
} from "./ecs/types";
export type {
  AnyProjectionSpec,
  Cause,
  ChangeHook,
  DescriptionNode,
  Ease,
  InitialOnly,
  InitialOnlyPair,
  LayerSort,
  LayerSpec,
  Motion,
  MotionCause,
  MotionHandle,
  NumericFields,
  ProjectionApi,
  ProjectionKey,
  ProjectionMotion,
  ProjectionSpec,
  ReducedMotion,
  RestOptions,
  SceneSwitch,
  TrackOptions,
  TrackSegment,
  TweenDriver,
  TweenOptions,
  ViewHandle,
  ViewOutput
} from "./projection/types";
