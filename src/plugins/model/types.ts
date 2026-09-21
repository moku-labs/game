/**
 * @file model plugin — shared types of the plugin and its modules.
 */
import type { Log } from "@moku-labs/common/browser";
import type { PluginCtx } from "@moku-labs/core";
import type { RngApi } from "./rng/types";
import type { Migration, PlayerStateProvider, StoreApi, StoreState } from "./store/types";

/**
 * Plain JSON value. Everything in state is JSON.
 *
 * @example
 * ```ts
 * const player: Json = { coins: 10, inventory: ["key"] };
 * ```
 */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/**
 * State roots reported by `model:committed`.
 *
 * @example
 * ```ts
 * const roots: Root[] = ["player", "rng"];
 * ```
 */
export type Root = "player" | "session" | "rng";

/**
 * model plugin events.
 *
 * @example
 * ```ts
 * hooks: { "model:committed": ({ roots, cause }) => reconcile(roots, cause) }
 * ```
 */
export type Events = {
  /** Committed state changed. Projections reconcile from the snapshot. */
  "model:committed": { roots: readonly Root[]; cause: "edge" | "rollback" | "restore" | "load" };
};

/**
 * model plugin config.
 *
 * @example
 * ```ts
 * createApp({ pluginConfigs: { model: { initialPlayer: { coins: 0 }, seed: 42 } } });
 * ```
 */
export type Config = {
  /** The save seam. `undefined`: an in-memory provider, nothing is persisted. */
  playerProvider: PlayerStateProvider | undefined;
  /** Player state of a new player. Deep-cloned. */
  initialPlayer: Json;
  /** Session state at every start. Deep-cloned. */
  initialSession: Json;
  /** "from-save": a new player gets a random seed once; a number fixes it (tests). */
  seed: "from-save" | number;
  /** Version of the save schema written by this build. */
  schemaVersion: number;
  /** Ordered chain; `up` of `from: n` produces version `n + 1`. */
  migrations: readonly Migration[];
};

/**
 * model plugin state: one branch per module.
 *
 * @example
 * ```ts
 * const state: State = createModelState({ global, config });
 * ```
 */
export type State = { store: StoreState; rng: Record<string, never> };

/**
 * model plugin API, grouped by module.
 *
 * @example
 * ```ts
 * const model: Api = ctx.require(modelPlugin);
 * model.store.snapshot();
 * ```
 */
export type Api = { store: StoreApi; rng: RngApi };

/**
 * Domain context shared by the modules.
 * `emit` is a method signature on purpose: a property-typed `emit` breaks the kernel's event
 * inference when a factory is passed to `createPlugin` by direct reference (`onStart`).
 *
 * @example
 * ```ts
 * export function createStoreApi(ctx: ModelCtx, deps: { createRngView: CreateRngView }): StoreApi;
 * ```
 */
export type ModelCtx = Omit<PluginCtx<Config, State, Events>, "emit"> & {
  emit<Name extends keyof Events>(name: Name, payload: Events[Name]): void;
  readonly global: object;
  readonly log: Log.LogApi;
};

export type { RngApi, RngState, RngStream, RngView } from "./rng/types";
export type {
  CommitResult,
  Migration,
  Patch,
  PlayerStateProvider,
  ProviderCall,
  SaveDoc,
  Snapshot,
  StoreApi,
  Transaction
} from "./store/types";
