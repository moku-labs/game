/**
 * @file `defineGameApp`: the game as one data object, and the two apps it is run as. `headless()`
 * composes the logic only; `screen()` composes the engine's screen set, the features and the
 * game's plugins. Both write the seam-owned plugin configs over the game's, per key, and default
 * to the fake clock at `startMoment` and a fresh memory save: they are test seams first, and the
 * page passes the device clock. The fake clock and the memory provider come from their plugin
 * files, never from the testing entry.
 */
import type { AnyPluginInstance } from "@moku-labs/core";
import type { Clock, Flow, I18n, Model } from "../index";
import {
  audioPlugin,
  createApp,
  effectsPlugin,
  flattenFeatures,
  platformPlugin,
  screen
} from "../index";
import { fakeClock, isFakeClock } from "../plugins/clock/fake";
import { memory } from "../plugins/model/store/providers/memory";
import type {
  GameApp,
  GameDefinition,
  GameHandle,
  GamePluginConfigs,
  HeadlessAppOf,
  HeadlessSeams,
  ScreenAppOf,
  ScreenSeams,
  WithGameState
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

/** The plugins every app has: the engine's core six and the core plugins `log` and `env`. */
const corePluginNames = [
  "time",
  "lifecycle",
  "model",
  "clock",
  "debug",
  "flow",
  "log",
  "env"
] as const;

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
  "pluginConfigs" | "strings"
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
 * Builds the error of a feature name met twice in one list.
 *
 * @param name - The feature name.
 * @param first - The path met first in the walk.
 * @param second - The path met second.
 * @returns The error.
 * @example
 * ```ts
 * listedTwice("ep01", "features[1].features[1]", "features[2]").message; // "[game] defineGameApp: the feature \"ep01\" is listed twice: features[1].features[1] and features[2].\n  List a sub-feature only in the features of its parent."
 * ```
 */
function listedTwice(name: string, first: string, second: string): Error {
  return new Error(
    `[game] defineGameApp: the feature "${name}" is listed twice: ${first} and ${second}.\n  List a sub-feature only in the features of its parent.`
  );
}

/** One entry of a feature tree as the check walks it: where it is, and what is there. */
type TreeEntry = { readonly path: string; readonly entry: Flow.FeaturePlugin | undefined };

/**
 * Lists every entry of a feature list and of the sub-features under it, depth first, a parent
 * before its children, each with its path. An entry without a `features` list has no children.
 *
 * @param list - A feature list, or the `features` of one entry.
 * @param path - Where the list is: `features`, `features[1].features`.
 * @returns The entries with their paths.
 */
function walkTree(list: readonly (Flow.FeaturePlugin | undefined)[], path: string): TreeEntry[] {
  return list.flatMap((entry, index) => {
    const at = `${path}[${index}]`;

    return [{ path: at, entry }, ...walkTree(entry?.features ?? [], `${at}.features`)];
  });
}

/**
 * Throws for the first entry of a feature tree, at any depth, that `defineFeature` did not make,
 * and for a feature name met twice in the tree. The type already rules out the first; a game in
 * JavaScript, or one that casts, is caught here, at the definition.
 *
 * @param list - `features` or `headless.features`.
 * @param root - The name of the list in the paths.
 * @throws {Error} When an entry has no `logicOnly`, or a name is listed twice.
 */
function checkTree(list: readonly (Flow.FeaturePlugin | undefined)[], root: string): void {
  const firstPaths = new Map<string, string>();

  for (const { path, entry } of walkTree(list, root)) {
    if (entry?.logicOnly === undefined) throw notAFeature(path);

    const first = firstPaths.get(entry.name);

    if (first !== undefined) throw listedTwice(entry.name, first, path);
    firstPaths.set(entry.name, path);
  }
}

/**
 * Throws for a `shared` that is not a feature, or that declares sub-features: the shared layer is
 * composed alone, so its children would never be.
 *
 * @param shared - The shared layer of the definition.
 * @throws {Error} When `shared` has no `logicOnly`, or its `features` is not empty.
 */
function checkShared(shared: Flow.FeaturePlugin): void {
  if (shared.logicOnly === undefined) throw notAFeature("shared");
  if ((shared.features ?? []).length > 0) {
    throw new Error(
      "[game] defineGameApp: shared declares sub-features.\n  The shared layer has none: declare them in a feature of features."
    );
  }
}

/**
 * Writes a value after `got` in an error: a string in quotes, anything else as it prints.
 *
 * @param value - The value the definition holds.
 * @returns The value as the error shows it.
 * @example
 * ```ts
 * shown("390"); // "\"390\""
 * ```
 */
function shown(value: unknown): string {
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

/**
 * Throws for a design frame the engine would draw wrong: a `referenceSide` that is not a finite
 * number above 0 (the fit answers scale 1, CSS-pixel size), and an `orientation` other than
 * `"portrait"` or `"landscape"` (most often `page.orientation`'s `"any"`). `referenceLong: 0` is
 * a documented value and is not checked.
 *
 * @param definition - The game's definition.
 * @throws {Error} When `referenceSide` or `orientation` is set to a value the engine cannot lay out.
 */
function checkFrame(definition: Definition): void {
  const side: unknown = definition.referenceSide;
  const orientation: unknown = definition.orientation;

  if (side !== undefined && !(typeof side === "number" && Number.isFinite(side) && side > 0)) {
    throw new Error(
      `[game] defineGameApp: referenceSide must be a finite number above 0, got ${shown(side)}.\n  Pass the short side of the design frame in reference units: defineGameApp({ referenceSide: 390, ... }).`
    );
  }

  if (orientation !== undefined && orientation !== "portrait" && orientation !== "landscape") {
    throw new Error(
      `[game] defineGameApp: orientation must be "portrait" or "landscape", got ${shown(orientation)}.\n  The layout is designed for one orientation. A native build that turns with the device sets page.orientation: "any" in config.ts.`
    );
  }
}

/**
 * Checks what TypeScript cannot stop: a definition from JavaScript, or one that casts.
 *
 * @param definition - The game's definition.
 * @throws {Error} When `flow` is missing, a feature entry at any depth is not a feature, a feature
 *   name is listed twice in one list, `shared` declares sub-features, or the design frame is one
 *   the engine cannot lay out.
 */
function checkDefinition(definition: Definition): void {
  if (definition.flow === undefined) {
    throw new Error(
      "[game] defineGameApp needs flow.\n  Pass the main flow: defineGameApp({ flow: mainFlow, ... })."
    );
  }

  if (definition.shared !== undefined) checkShared(definition.shared);
  checkTree(definition.features ?? [], "features");
  checkTree(definition.headless?.features ?? [], "headless.features");
  checkFrame(definition);
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
 * owns stays, a key the shell owns is written. With `screen` the screen keys are written too. The
 * game's adaptive frame rate stands only in a screen app on a device clock (the page): a headless
 * app and a screen app on a fake clock never adapt.
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
    flow: { ...game.flow, mainFlow: definition.flow, safeNode: definition.safeNode },
    time: {
      ...game.time,
      ...(withScreen && !isFakeClock(runtime.clock) ? {} : { adaptive: false })
    }
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
 * Creates one app over the engine: the plugins in order, the merged configs, and the frame keys
 * `orientation`, `referenceSide` and `referenceLong` only when the definition sets them. A
 * definition that sets none passes no `config` key, so the core defaults stay the one place of
 * truth.
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
  const frame = definedKeys({
    orientation: definition.orientation,
    referenceSide: definition.referenceSide,
    referenceLong: definition.referenceLong
  });

  return createApp({
    plugins: [...plugins],
    pluginConfigs,
    ...(Object.keys(frame).length === 0 ? {} : { config: frame })
  });
}

/**
 * Makes the headless app of a definition: the logic of `headless.features` and of their
 * sub-features, then `headless.plugins`. Without a `headless.features` list it takes `features`;
 * an empty list means none. `shared` is not composed. The `logicOnly` is taken before flattening:
 * a parent's `logicOnly` carries its children's.
 *
 * @param definition - The game's definition.
 * @param seams - The seams of this call.
 * @returns The app, not started, and its clock and provider.
 */
function headlessOf(definition: Definition, seams: Seams) {
  const runtime = runtimeOf(seams);
  const plugins = [
    ...flattenFeatures(
      (definition.headless?.features ?? definition.features ?? []).map(feature => feature.logicOnly)
    ),
    ...(definition.headless?.plugins ?? [])
  ];
  const configs = composedOnly(mergeConfigs(definition, seams, runtime, false), plugins);

  return { app: appOf(definition, plugins, configs), ...runtime };
}

/**
 * Makes the screen app of a definition: the screen set, `audio`, `effects`, `platform`, then
 * `shared`, the features with their sub-features (depth first, a parent before its children) and
 * the game's plugins.
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
    ...flattenFeatures(definition.features ?? []),
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
 * tuples, the player, the session and, through `strings: type<Strings>()`, the string keys. Checks the definition at once, so an error points at
 * `index.ts`.
 *
 * @param definition - The game: its flow, starting state, features, plugins and plugin configs.
 * @returns The game, with `headless()` and `screen()`; no app is created yet.
 * @throws {Error} When `flow` is missing, or an entry of `shared`, `features` or `headless.features`
 *   is not a feature, at any depth of the tree.
 * @throws {Error} When a feature name is listed twice in `features` or in `headless.features`: the
 *   game and a parent both list it, or two parents declare it.
 * @throws {Error} When `shared` declares sub-features.
 * @throws {Error} When `referenceSide` is not a finite number above 0, or `orientation` is neither
 *   `"portrait"` nor `"landscape"`.
 * @example
 * ```ts
 * // index.ts of a game: the whole game, no createApp call. Its tests import it as `game`.
 * export default defineGameApp({
 *   flow: mainFlow, safeNode: "home", player: startingPlayer, session: startingSession, strings: type<Strings>(),
 *   shared: sharedFeature, features: [homeFeature, boardFeature, rewardFeature], plugins: [loadingPlugin],
 *   headless: { features: [rewardFeature] }, pluginConfigs: { ui: { tapTargetPt: 48 } }
 * });
 * game.headless({ seed: 7 }).app.flow.state().running; // false: the test starts it
 * game.screen().app.i18n.isKey("home.play"); // a guard to the game's keys: true for a key of Strings
 * ```
 */
export function defineGameApp<
  const Plugins extends readonly AnyPluginInstance[] = readonly [],
  const HeadlessPlugins extends readonly AnyPluginInstance[] = readonly [],
  Player extends Model.Json = Model.Json,
  Session extends Model.Json = Model.Json,
  Strings extends I18n.StringTable = I18n.StringTable
>(
  definition: GameDefinition<Plugins, HeadlessPlugins, Player, Session, Strings>
): GameApp<Plugins, HeadlessPlugins, Player, Session, Strings> {
  const wide: Definition = definition;

  checkDefinition(wide);

  // The plugin lists run as plain arrays, so `createApp` types a wide app; the real app type comes
  // from the inferred tuples. A seam left out is the default the method's type parameter names
  // (the fake clock, the memory provider). TypeScript follows neither, so one cast per method.
  return {
    headless: <Source extends Clock.ClockSource, Provider extends Model.PlayerStateProvider>(
      seams: HeadlessSeams<Player, Session, Source, Provider> = {}
    ) =>
      headlessOf(wide, seams) as GameHandle<
        WithGameState<HeadlessAppOf<HeadlessPlugins>, Player, Session, Strings>,
        Source,
        Provider
      >,
    screen: <Source extends Clock.ClockSource, Provider extends Model.PlayerStateProvider>(
      seams: ScreenSeams<Player, Session, Source, Provider> = {}
    ) =>
      screenOf(wide, seams) as GameHandle<
        WithGameState<ScreenAppOf<Plugins>, Player, Session, Strings>,
        Source,
        Provider
      >
  };
}
