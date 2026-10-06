/**
 * @file `defineGameApp`: the game as one data object, and the two apps it is run as. `headless()`
 * composes the logic only; `screen()` composes the engine's screen set, the features and the
 * game's plugins. Both write the seam-owned plugin configs over the game's, per key, and default
 * to the fake clock at `startMoment` and a fresh memory save: they are test seams first, and the
 * page passes the device clock. The fake clock and the memory provider come from their plugin
 * files, never from the testing entry.
 */
import type { AnyPluginInstance } from "@moku-labs/core";
import type { Clock, Flow, Model } from "../index";
import { audioPlugin, createApp, effectsPlugin, platformPlugin, screen } from "../index";
import { fakeClock } from "../plugins/clock/fake";
import { memory } from "../plugins/model/store/providers/memory";
import type {
  GameApp,
  GameDefinition,
  GameHandle,
  GamePluginConfigs,
  HeadlessAppOf,
  HeadlessSeams,
  ScreenAppOf,
  ScreenSeams
} from "./types";

/**
 * The moment the default fake clock starts at, in epoch milliseconds. A test stamps times from it.
 *
 * @example
 * ```ts
 * game.headless().clock.now() === startMoment; // true
 * ```
 */
export const startMoment = 1_000_000;

/** The rng seed of a new save when neither the definition nor the seam names one. */
const defaultSeed = 42;

/** The plugins every app has: the engine's core five and the core plugins `log` and `env`. */
const corePluginNames = ["time", "lifecycle", "model", "clock", "flow", "log", "env"] as const;

/**
 * The game's plugin configs as the merge reads them: the five keys it writes into typed, every
 * other plugin's config by name.
 */
type GameConfigs = Pick<GamePluginConfigs, "model" | "flow" | "renderer" | "assets" | "audio"> & {
  readonly [plugin: string]: object | undefined;
};

/** The definition as the composition reads it: every plugin list and both states widened. */
type Definition = Omit<
  GameDefinition<readonly AnyPluginInstance[], readonly AnyPluginInstance[]>,
  "pluginConfigs"
> & { readonly pluginConfigs?: GameConfigs };

/** The seams as the composition reads them: the screen seams, the clock and save widened. */
type Seams = ScreenSeams<Model.Json, Model.Json, Clock.ClockSource, Model.PlayerStateProvider>;

/** The plugin configs one app is created with: the game's, with the seam-owned keys written over. */
type MergedConfigs = { readonly [plugin: string]: object | undefined };

/** What one app runs on: the clock and the save provider, from the seams or the defaults. */
type Runtime = { clock: Clock.ClockSource; provider: Model.PlayerStateProvider };

/**
 * Builds the error of a list entry that is not a feature.
 *
 * @param path - The list and index, `features[2]`, or `shared`.
 * @returns The error.
 * @example
 * ```ts
 * notAFeature("features[2]").message; // "[game] defineGameApp: features[2] is not a feature.\n  Make it with defineFeature(name, description)."
 * ```
 */
function notAFeature(path: string): Error {
  return new Error(
    `[game] defineGameApp: ${path} is not a feature.\n  Make it with defineFeature(name, description).`
  );
}

/**
 * Throws for the first entry of a feature list that `defineFeature` did not make. The type already
 * says so; a game in JavaScript, or one that casts, is caught here, at the definition.
 *
 * @param list - `features`, `headless.features`, or `[shared]`.
 * @param pathOf - Names an entry by its index.
 * @throws {Error} When an entry has no `logicOnly`.
 */
function checkFeatures(
  list: readonly (Flow.FeaturePlugin | undefined)[],
  pathOf: (index: number) => string
): void {
  for (const [index, entry] of list.entries()) {
    if (entry?.logicOnly === undefined) throw notAFeature(pathOf(index));
  }
}

/**
 * Checks what TypeScript cannot stop: a definition from JavaScript, or one that casts.
 *
 * @param definition - The game's definition.
 * @throws {Error} When `flow` is missing, or a feature entry is not a feature.
 */
function checkDefinition(definition: Definition): void {
  if (definition.flow === undefined) {
    throw new Error(
      "[game] defineGameApp needs flow.\n  Pass the main flow: defineGameApp({ flow: mainFlow, ... })."
    );
  }

  if (definition.shared !== undefined) checkFeatures([definition.shared], () => "shared");
  checkFeatures(definition.features ?? [], index => `features[${index}]`);
  checkFeatures(definition.headless?.features ?? [], index => `headless.features[${index}]`);
}

/**
 * Copies the keys of a seam whose value is set, so a seam left out never erases a game value.
 *
 * @param seam - One seam object, or `undefined`.
 * @returns The set keys only.
 * @example
 * ```ts
 * definedKeys({ journal: 200, context: undefined }); // { journal: 200 }
 * ```
 */
function definedKeys<Seam extends object>(seam: Seam | undefined): Partial<Seam> {
  if (seam === undefined) return {};

  return Object.fromEntries(
    Object.entries(seam).filter(([, value]) => value !== undefined)
  ) as Partial<Seam>;
}

/**
 * Merges the seam-owned keys over the game's plugin configs, one plugin at a time: a key the game
 * owns stays, a key the shell owns is written. With `screen` the screen keys are written too.
 *
 * @param definition - The game's definition.
 * @param seams - The seams of this call.
 * @param runtime - The clock and the save provider of this call.
 * @param withScreen - Whether the app is the screen app.
 * @returns The plugin configs of the app.
 */
function mergeConfigs(
  definition: Definition,
  seams: Seams,
  runtime: Runtime,
  withScreen: boolean
): MergedConfigs {
  const game: GameConfigs = definition.pluginConfigs ?? {};
  const logic = {
    ...game,
    model: {
      ...game.model,
      playerProvider: runtime.provider,
      initialPlayer: seams.player ?? definition.player,
      initialSession: seams.session ?? definition.session,
      seed: seams.seed ?? definition.seed ?? defaultSeed
    },
    clock: { source: runtime.clock },
    flow: { ...game.flow, mainFlow: definition.flow, safeNode: definition.safeNode }
  };

  if (!withScreen) return logic;

  return {
    ...logic,
    platform: { provider: seams.platform, keepAwake: seams.keepAwake ?? false },
    renderer: { ...game.renderer, ...definedKeys(seams.renderer) },
    assets: { ...game.assets, manifest: seams.manifest, io: seams.io },
    audio: { ...game.audio, ...definedKeys(seams.audio) }
  };
}

/**
 * Keeps the configs of the plugins an app composes. Core takes unknown keys at run time, but the
 * headless app's type would not: a headless app gets no screen or unlisted game plugin config.
 *
 * @param configs - The merged configs.
 * @param plugins - The plugins the app composes beyond the core.
 * @returns The configs of the composed plugins only.
 */
function composedOnly(
  configs: MergedConfigs,
  plugins: readonly AnyPluginInstance[]
): MergedConfigs {
  const names = new Set<string>([...corePluginNames, ...plugins.map(plugin => plugin.name)]);

  return Object.fromEntries(Object.entries(configs).filter(([name]) => names.has(name)));
}

/**
 * Picks the clock and the save provider of one call: the seams', or a fresh fake clock at
 * `startMoment` and a fresh memory provider.
 *
 * @param seams - The seams of this call.
 * @returns The clock and the provider.
 */
function runtimeOf(seams: Seams): Runtime {
  return { clock: seams.clock ?? fakeClock(startMoment), provider: seams.provider ?? memory() };
}

/**
 * Creates one app over the engine: the plugins in order, the merged configs, and `referenceLong`
 * only when the definition sets it.
 *
 * @param definition - The game's definition.
 * @param plugins - The plugins beyond the core, in order.
 * @param pluginConfigs - The merged configs.
 * @returns The app, not started.
 */
function appOf(
  definition: Definition,
  plugins: readonly AnyPluginInstance[],
  pluginConfigs: MergedConfigs
) {
  return createApp({
    plugins: [...plugins],
    pluginConfigs,
    ...(definition.referenceLong === undefined
      ? {}
      : { config: { referenceLong: definition.referenceLong } })
  });
}

/**
 * Makes the headless app of a definition: the logic of `headless.features`, then
 * `headless.plugins`.
 *
 * @param definition - The game's definition.
 * @param seams - The seams of this call.
 * @returns The app, not started, and its clock and provider.
 */
function headlessOf(definition: Definition, seams: Seams) {
  const runtime = runtimeOf(seams);
  const plugins = [
    ...(definition.headless?.features ?? []).map(feature => feature.logicOnly),
    ...(definition.headless?.plugins ?? [])
  ];
  const configs = composedOnly(mergeConfigs(definition, seams, runtime, false), plugins);

  return { app: appOf(definition, plugins, configs), ...runtime };
}

/**
 * Makes the screen app of a definition: the screen set, `audio`, `effects`, `platform`, then
 * `shared`, the features and the game's plugins.
 *
 * @param definition - The game's definition.
 * @param seams - The seams of this call.
 * @returns The app, not started, and its clock and provider.
 */
function screenOf(definition: Definition, seams: Seams) {
  const runtime = runtimeOf(seams);
  const plugins = [
    ...screen,
    audioPlugin,
    effectsPlugin,
    platformPlugin,
    ...(definition.shared === undefined ? [] : [definition.shared]),
    ...(definition.features ?? []),
    ...(definition.plugins ?? [])
  ];

  return {
    app: appOf(definition, plugins, mergeConfigs(definition, seams, runtime, true)),
    ...runtime
  };
}

/**
 * Turns a game's one data object into the game: `game.headless()` for logic tests and
 * `game.screen()` for the page and the screen tests. Every type comes from the object: the plugin
 * tuples, the player and the session. Checks the definition at once, so an error points at
 * `index.ts`.
 *
 * @param definition - The game: its flow, starting state, features, plugins and plugin configs.
 * @returns The game, with `headless()` and `screen()`; no app is created yet.
 * @throws {Error} When `flow` is missing, or an entry of `shared`, `features` or `headless.features` is not a feature.
 * @example
 * ```ts
 * // index.ts of a game: the whole game, no createApp call. Its tests import it as `game`.
 * export default defineGameApp({
 *   flow: mainFlow, safeNode: "home", player: startingPlayer, session: startingSession,
 *   shared: sharedFeature, features: [homeFeature, boardFeature, rewardFeature], plugins: [loadingPlugin],
 *   headless: { features: [rewardFeature] }, pluginConfigs: { ui: { tapTargetPt: 48 } }
 * });
 * game.headless({ seed: 7 }).app.flow.state().running; // false: the test starts it
 * ```
 */
export function defineGameApp<
  const Plugins extends readonly AnyPluginInstance[] = readonly [],
  const HeadlessPlugins extends readonly AnyPluginInstance[] = readonly [],
  Player extends Model.Json = Model.Json,
  Session extends Model.Json = Model.Json
>(
  definition: GameDefinition<Plugins, HeadlessPlugins, Player, Session>
): GameApp<Plugins, HeadlessPlugins, Player, Session> {
  const wide: Definition = definition;

  checkDefinition(wide);

  // The plugin lists run as plain arrays, so `createApp` types a wide app; the real app type comes
  // from the inferred tuples. A seam left out is the default the method's type parameter names
  // (the fake clock, the memory provider). TypeScript follows neither, so one cast per method.
  return {
    headless: <Source extends Clock.ClockSource, Provider extends Model.PlayerStateProvider>(
      seams: HeadlessSeams<Player, Session, Source, Provider> = {}
    ) => headlessOf(wide, seams) as GameHandle<HeadlessAppOf<HeadlessPlugins>, Source, Provider>,
    screen: <Source extends Clock.ClockSource, Provider extends Model.PlayerStateProvider>(
      seams: ScreenSeams<Player, Session, Source, Provider> = {}
    ) => screenOf(wide, seams) as GameHandle<ScreenAppOf<Plugins>, Source, Provider>
  };
}
