/**
 * @file `@moku-labs/game/app/system`: the system shell a game runs in. It builds the
 * `@moku-labs/system` app from the names `config.ts` lists, one lazy `import()` per name, and
 * hands the engine two things over it: the platform provider and, for a store save, the save
 * provider. The only file of the engine that reaches `@moku-labs/system`: a web-only game never
 * imports this entry, so neither its bundle nor its typecheck meets the package.
 */
import type { AnyPluginInstance } from "@moku-labs/core";
import type {
  Back,
  createApp as createSystem,
  Haptics,
  KeepAwake,
  Lifecycle,
  Store,
  SystemErr,
  SystemResult
} from "@moku-labs/system";
import type { storePlugin } from "@moku-labs/system/store";
import { applyTo } from "../plugins/model/store/drafts";
import type { JsonDocument, Patch, PlayerStateProvider } from "../plugins/model/store/types";
import type { HapticKind, PlatformProvider } from "../plugins/platform/types";
import type { ResolvedGameConfig, SystemName, SystemShell } from "./types";

/**
 * What the bridge reads of the system app: the four capabilities, each one there only when the
 * game names its plugin. A system app of `lifecyclePlugin`, `backPlugin`, `hapticsPlugin` and
 * `keepAwakePlugin` has all of them.
 *
 * @example
 * ```ts
 * const slice: SystemSlice = await createSystemApp(["haptics"], "moku-game"); // slice.haptics only
 * ```
 */
export type SystemSlice = {
  /** Pause and resume, from `@moku-labs/system/lifecycle`. */
  readonly lifecycle?: Lifecycle.LifecycleApi;
  /** The hardware Back press and the exit, from `@moku-labs/system/back`. */
  readonly back?: Back.BackApi;
  /** Impact, outcome and selection ticks, from `@moku-labs/system/haptics`. */
  readonly haptics?: Haptics.HapticsApi;
  /** The screen wake lock, from `@moku-labs/system/keep-awake`. */
  readonly keepAwake?: KeepAwake.KeepAwakeApi;
};

/**
 * What the store save reads of the system store: one read and one write.
 *
 * @example
 * ```ts
 * const system = createApp({ plugins: [storePlugin] }); // createApp of @moku-labs/system
 * const store: StoreSlice = system.store;
 * ```
 */
export type StoreSlice = Pick<Store.StoreApi, "get" | "set">;

/**
 * The system app of the game shell: the capabilities of the plugins the game names, the store
 * among them, and the start and stop of the app.
 *
 * @example
 * ```ts
 * const system: SystemApp = await createSystemApp(["lifecycle", "store"], "com.mokulabs.timber");
 * await system.start(); // system.lifecycle and system.store answer from here on
 * ```
 */
export type SystemApp = SystemSlice & {
  /** Key-value persistence, from `@moku-labs/system/store`. */
  readonly store?: Store.StoreApi;
  /** Starts the system app: every capability picks its provider. */
  readonly start: () => Promise<void>;
  /** Stops the system app: every capability lets go of its provider. */
  readonly stop: () => Promise<void>;
};

/** The value a save takes in the store: the document and its schema version, as `load()` answers. */
type StoredSave = { state: JsonDocument; version: number };

/**
 * What the store save holds: the document as last loaded or committed, and the last queued write,
 * `undefined` before the first.
 */
type Held = {
  document: JsonDocument | undefined;
  written: Promise<string | undefined> | undefined;
};

/** A system plugin the bridge reads: every name but the store. */
type CapabilityName = Exclude<SystemName, "store">;

/**
 * What the shell takes of `@moku-labs/system`: its `createApp`, the capability plugins of the
 * names, and the store plugin when the names hold it. The store keeps its own type: its config
 * names the store.
 */
type Loaded = {
  createApp: typeof createSystem;
  capabilities: AnyPluginInstance[];
  store: typeof storePlugin | undefined;
};

/** The system plugins in the order the shell composes them, whatever the order of `config.ts`. */
const systemOrder: readonly SystemName[] = ["lifecycle", "back", "haptics", "keepAwake", "store"];

/** One lazy import per capability plugin: the page loads only the plugins the game names. */
const capabilityLoaders: Readonly<Record<CapabilityName, () => Promise<AnyPluginInstance>>> = {
  lifecycle: () => import("@moku-labs/system/lifecycle").then(module => module.lifecyclePlugin),
  back: () => import("@moku-labs/system/back").then(module => module.backPlugin),
  haptics: () => import("@moku-labs/system/haptics").then(module => module.hapticsPlugin),
  keepAwake: () => import("@moku-labs/system/keep-awake").then(module => module.keepAwakePlugin)
};

/**
 * Loads the store plugin, by its own lazy import.
 *
 * @returns The store plugin.
 */
function loadStore(): Promise<typeof storePlugin> {
  return import("@moku-labs/system/store").then(module => module.storePlugin);
}

/** The store namespace of a game with no native identifier. */
const defaultNamespace = "moku-game";

/** The store key of the save, inside the game's namespace. */
const saveKey = "save";

/**
 * Removes nothing: the remover of a subscription the shell cannot make, because the game did not
 * name the capability.
 */
function removeNothing(): void {
  // Nothing was subscribed, so there is nothing to remove.
}

/**
 * Plays one tick of the engine with the capability of its kind: the three impacts, the three
 * outcome patterns, and the selection tick.
 *
 * @param haptics - The haptics capability of the system app.
 * @param kind - One of the seven kinds of `HAPTIC_KINDS`.
 * @returns What the shell answered.
 */
function play(haptics: Haptics.HapticsApi, kind: HapticKind): Promise<SystemResult<void>> {
  switch (kind) {
    case "light":
    case "medium":
    case "heavy": {
      return haptics.impact(kind);
    }
    case "success":
    case "warning":
    case "error": {
      return haptics.notify(kind);
    }
    case "selection": {
      return haptics.selection();
    }
  }
}

/**
 * Asks the shell without waiting for the answer. A capability answers with a `SystemResult`, never
 * a throw, and the provider of the engine returns nothing: a tick the shell cannot play (iOS
 * Safari, a desktop) is an honest `unsupported`, not an error of the game. A capability the game
 * did not name is not asked.
 *
 * @param capability - The capability, or `undefined` when the game did not name it.
 * @param ask - The capability call.
 */
function send<Capability>(
  capability: Capability | undefined,
  ask: (capability: Capability) => Promise<SystemResult<void>>
): void {
  if (capability !== undefined) void ask(capability);
}

/**
 * Subscribes through a capability, or subscribes nothing when the game did not name it.
 *
 * @param capability - The capability, or `undefined` when the game did not name it.
 * @param listen - The subscription; it returns its remover.
 * @returns The remover of the subscription, or one that removes nothing.
 */
function subscribe<Capability>(
  capability: Capability | undefined,
  listen: (capability: Capability) => () => void
): () => void {
  return capability === undefined ? removeNothing : listen(capability);
}

/**
 * Builds the engine's provider over the system app. On iOS `exit` answers `unsupported`, so Leave
 * lands back on Home there, as on the web page. A capability the slice lacks is inert, as the
 * platform plugin is without a provider: its subscriptions remove nothing and its calls do nothing.
 *
 * @param system - The system app, with the capabilities the game names.
 * @returns The provider to pass as the `platform` seam of `game.screen()`.
 * @example
 * ```ts
 * import { createApp as createSystem } from "@moku-labs/system";
 * const system = createSystem({ plugins: [lifecyclePlugin, backPlugin, hapticsPlugin, keepAwakePlugin] });
 * fromSystem(system).haptic("success"); // the shell plays system.haptics.notify("success")
 * fromSystem({}).exit(); // does nothing: the game named no back capability
 * ```
 */
export function fromSystem(system: SystemSlice): PlatformProvider {
  return {
    onPause: fn => subscribe(system.lifecycle, lifecycle => lifecycle.onPause(fn)),
    onResume: fn => subscribe(system.lifecycle, lifecycle => lifecycle.onResume(fn)),
    onBack: fn => subscribe(system.back, back => back.onPress(fn)),
    haptic: kind => send(system.haptics, haptics => play(haptics, kind)),
    keepAwake: on => send(system.keepAwake, keepAwake => keepAwake.set(on)),
    exit: () => send(system.back, back => back.exit())
  };
}

/**
 * Loads `@moku-labs/system` and the plugins of the names, all at once.
 *
 * @param names - The system plugins, in the fixed order.
 * @returns The `createApp` of the package, the capability plugins in the order of the names, and
 *   the store plugin when the names hold it.
 * @throws {Error} When the package is not installed.
 */
async function loadSystem(names: readonly SystemName[]): Promise<Loaded> {
  const capabilities = names.filter((name): name is CapabilityName => name !== "store");

  try {
    const [system, store, ...plugins] = await Promise.all([
      import("@moku-labs/system"),
      names.includes("store") ? loadStore() : undefined,
      ...capabilities.map(name => capabilityLoaders[name]())
    ]);

    return { createApp: system.createApp, capabilities: plugins, store };
  } catch (error) {
    throw new Error(
      "[game] config.system needs @moku-labs/system.\n  Install it: bun add @moku-labs/system@^0.3.1.",
      { cause: error }
    );
  }
}

/**
 * Creates the `@moku-labs/system` app of the named plugins, in the fixed order `lifecycle`,
 * `back`, `haptics`, `keepAwake`, `store`, each name once. The store is named after `namespace`.
 * Each plugin is loaded by its own `import()`, so a page loads only the plugins its game names.
 * The app is not started.
 *
 * @param names - The system plugins the game names, in any order.
 * @param namespace - The store name: the native identifier, or `"moku-game"`.
 * @returns The system app, not started.
 * @throws {Error} When `@moku-labs/system` is not installed.
 * @example
 * ```ts
 * // A shell of its own: the store named after the app, and the haptics.
 * const system = await createSystemApp(["store", "haptics"], "com.mokulabs.timber");
 * await system.start();
 * await system.haptics?.selection(); // { ok: false, provider: "web", reason: "unsupported" } in iOS Safari
 * ```
 */
export async function createSystemApp(
  names: readonly SystemName[],
  namespace: string
): Promise<SystemApp> {
  const ordered = systemOrder.filter(name => names.includes(name));
  const { createApp, capabilities, store } = await loadSystem(ordered);

  // The store is last in the fixed order, so it goes after the capabilities.
  if (store === undefined) return createApp({ plugins: capabilities });

  return createApp({
    plugins: [...capabilities, store],
    pluginConfigs: { store: { name: namespace } }
  });
}

/**
 * Names why the store said no: the reason, and the store's own words when it gave some.
 *
 * @param failure - The failed answer of the store.
 * @returns The reason, for an error message.
 * @example
 * ```ts
 * failureText({ ok: false, provider: "tauri", reason: "denied", message: "not allowed" }); // "denied, not allowed"
 * ```
 */
function failureText(failure: SystemErr): string {
  return failure.message === undefined ? failure.reason : `${failure.reason}, ${failure.message}`;
}

/**
 * Builds the message of a save the store did not take.
 *
 * @param reason - Why the store did not take it.
 * @returns The message.
 * @example
 * ```ts
 * notStored("denied"); // "[game] The save was not stored: denied.\n  Check the store permission of the native build; progress since the last stored save is lost on close."
 * ```
 */
function notStored(reason: string): string {
  return `[game] The save was not stored: ${reason}.\n  Check the store permission of the native build; progress since the last stored save is lost on close.`;
}

/**
 * Writes the whole save once, after the write before it. It never rejects, so one refused write
 * never stops the writes after it.
 *
 * @param previous - The write before this one, or `undefined` for the first.
 * @param store - The system store.
 * @param key - The store key of the save.
 * @param value - The document and its version.
 * @returns The problem of a write the store did not take, or `undefined` once it is stored.
 */
async function write(
  previous: Promise<string | undefined> | undefined,
  store: StoreSlice,
  key: string,
  value: StoredSave
): Promise<string | undefined> {
  await previous;

  try {
    const result = await store.set(key, value);

    return result.ok ? undefined : notStored(failureText(result));
  } catch (error) {
    return notStored(error instanceof Error ? error.message : String(error));
  }
}

/**
 * Reports the problem of a write nobody waits for, once the write is done.
 *
 * @param written - The queued write.
 * @param report - Takes the problem of a write the store did not take.
 */
async function reportProblem(
  written: Promise<string | undefined>,
  report: (problem: string) => void
): Promise<void> {
  const problem = await written;

  if (problem !== undefined) report(problem);
}

/**
 * Builds the save provider over the system store: idb on the web, the Tauri store in the native
 * app. It holds the document it loaded and applies each commit's patches to it, then queues one
 * write of the whole value, so the writes stay in commit order. A read the store refuses rejects
 * the load: answering "new player" would overwrite a real save at the first commit. A write the
 * store refuses is reported from `commit` and rejects `commitDurable`; the next write still goes.
 *
 * @param store - The system store.
 * @param key - The store key of the save.
 * @param report - Takes the problem of a write `commit` could not store.
 * @returns The provider to pass as the `provider` seam of `game.screen()`.
 * @example
 * ```ts
 * import { createApp as createSystem } from "@moku-labs/system";
 * const system = createSystem({ plugins: [storePlugin], pluginConfigs: { store: { name: "com.mokulabs.timber" } } });
 * await system.start();
 * const save = storeSave(system.store, "save", problem => problems.push(problem));
 * await save.load(); // null for a new player; rejects when the store cannot be read
 * ```
 */
export function storeSave(
  store: StoreSlice,
  key: string,
  report: (problem: string) => void
): PlayerStateProvider {
  const held: Held = { document: undefined, written: undefined };

  /**
   * Applies the patches of one commit to the held document and queues the write of the whole
   * value after the last one.
   *
   * @param patches - Doc patches since the last commit.
   * @param version - Schema version this build writes.
   * @returns The problem of this write, or `undefined` once it is stored.
   */
  const queue = (patches: Patch[], version: number): Promise<string | undefined> => {
    const document = applyTo(held.document ?? {}, patches);
    const written = write(held.written, store, key, { state: document, version });

    held.document = document;
    held.written = written;

    return written;
  };

  return {
    load: async () => {
      const read = await store.get<StoredSave>(key);

      if (!read.ok) {
        throw new Error(
          `[game] The save could not be read from the system store: ${failureText(read)}.\n  The game does not start over it; check the store permission of the native build.`
        );
      }

      // eslint-disable-next-line unicorn/no-null -- `null` is the provider contract for a new player.
      if (read.value === undefined) return null;

      held.document = read.value.state;

      return { state: read.value.state, version: read.value.version };
    },

    // The patches apply at once, so a bad patch throws to the model; the write is only queued.
    commit: (patches, version) => {
      void reportProblem(queue(patches, version), report);
    },

    commitDurable: async (patches, _txId, version) => {
      const problem = await queue(patches, version);

      if (problem !== undefined) throw new Error(problem);
    },

    flush: async () => {
      await held.written;
    }
  };
}

/**
 * Builds the system shell from the resolved `config.ts`: the `@moku-labs/system` app of the names
 * `config.system` lists, plus the store when `config.save` is `"store"`, in the fixed order. It
 * hands the engine the platform provider over that app and, for a store save, the save provider.
 * The page starts the shell before the game; this function does not start it. The generated
 * `main.ts` passes the function itself to `startPage`, only when `config.ts` names a system
 * plugin or the store save.
 *
 * @param config - The resolved `config.ts` of the game.
 * @param report - Takes a problem the page reports later, such as a write the store refused.
 * @returns The shell, not started.
 * @throws {Error} When `@moku-labs/system` is not installed.
 * @example
 * ```ts
 * // The in-memory .moku/build/main.ts of moku-game build, for a game whose config.ts names system plugins.
 * import { startPage } from "@moku-labs/game/app/page";
 * import { systemShell } from "@moku-labs/game/app/system";
 * import game from "../../index.ts";
 * import config from "../../config.ts";
 *
 * await startPage(game, config, { system: systemShell });
 * ```
 */
export async function systemShell(
  config: ResolvedGameConfig,
  report: (problem: string) => void
): Promise<SystemShell> {
  const names: readonly SystemName[] =
    config.save === "store" ? [...config.system, "store"] : config.system;
  const app = await createSystemApp(names, config.native?.identifier ?? defaultNamespace);

  return {
    handle: app,
    platform: fromSystem(app),
    save: app.store === undefined ? undefined : storeSave(app.store, saveKey, report),
    start: () => app.start(),
    stop: () => app.stop()
  };
}
