/**
 * @file The public types of the game shell: `@moku-labs/game/app` (the game as one data object and
 * its two apps), `@moku-labs/game/app/page` (the page that runs it) and
 * `@moku-labs/game/app/system` (the native shell behind it). Only types: no value, no `node:`
 * module and no `@moku-labs/system` type, so a web-only game typechecks without the optional peers.
 */
import type { AnyPluginInstance } from "@moku-labs/core";
import type {
  Assets,
  Audio,
  audioPlugin,
  Clock,
  createApp,
  effectsPlugin,
  Flow,
  Model,
  Platform,
  platformPlugin,
  Renderer,
  screen
} from "../index";
import type { memory } from "../plugins/model/store/providers/memory";

// ─── config.ts: the page, the native app, the shell ───────────

/**
 * The name of a `@moku-labs/system` plugin the game shell wires, as the system package names it.
 * Only the five a game shell uses.
 *
 * @example
 * ```ts
 * const wanted: SystemName[] = ["lifecycle", "back", "haptics", "keepAwake"];
 * ```
 */
export type SystemName = "lifecycle" | "back" | "haptics" | "keepAwake" | "store";

/**
 * Where the player's save lives: in memory for this page only, in `localStorage`, or in the
 * system store (idb on the web, the Tauri store in the native shell).
 *
 * @example
 * ```ts
 * const save: SaveKind = "local"; // progress survives a reload of the page
 * ```
 */
export type SaveKind = "memory" | "local" | "store";

/**
 * What `config.ts` of a game holds: plain data, no call. The page, the native build and the shell
 * read it; the game logic never does.
 *
 * @example
 * ```ts
 * // config.ts of a game
 * import type { GameConfig } from "@moku-labs/game/app";
 * export default {
 *   page: { title: "Лесной городок", lang: "ru", background: "#10161d", orientation: "portrait", icons: { favicon: "assets/icon.png" } },
 *   native: { name: "Лесной городок", identifier: "com.mokulabs.timber", icon: "assets/icon.png" },
 *   system: ["lifecycle", "back", "haptics", "keepAwake"],
 *   save: "memory",
 *   assets: { layers: { shared: "ui" } }
 * } satisfies GameConfig;
 * ```
 */
export type GameConfig = {
  /** The HTML page the game runs in. */
  page: {
    /** The page title. Required, never empty. */
    title: string;
    /** The `lang` of the page. Default `"en"`. */
    lang?: string;
    /** CSS colour of the page behind the canvas, also the native window. Default `"#000000"`. */
    background?: string;
    /** The orientation the native build locks. Default `"portrait"`. */
    orientation?: "portrait" | "landscape" | "any";
    /** Icon files, relative to the game folder. None by default. */
    icons?: { favicon?: string; appleTouch?: string };
    /** Raw tags written into `<head>`, verbatim, in order. None by default. */
    head?: readonly string[];
  };
  /** The native app. Left out, the game has no native build. */
  native?: {
    /** The app name under the icon. */
    name: string;
    /** The bundle identifier, reverse DNS. */
    identifier: string;
    /** A 1024 px PNG, relative to the game folder. A placeholder by default. */
    icon?: string;
    /** The native targets a build makes. The target of the command by default. */
    targets?: readonly ("ios" | "android" | "macos")[];
  };
  /** The system plugins the shell wires. Default `[]`, a web page with no shell. */
  system?: readonly SystemName[];
  /** Where the save lives. Default `"memory"`. */
  save?: SaveKind;
  /** The asset build. Default: no layers. */
  assets?: {
    /** Asset layers by name: `{ shared: "ui" }` packs the shared layer from `features/ui`. */
    layers?: Readonly<Record<string, string>>;
  };
};

/**
 * `GameConfig` with every default filled, as `resolveConfig` returns it. The page, the CLI and the
 * shell read this one, never the raw config.
 *
 * @example
 * ```ts
 * const settings: ResolvedGameConfig = {
 *   page: { title: "mini-game", lang: "en", background: "#000000", orientation: "portrait", icons: {}, head: [] },
 *   native: undefined, system: [], save: "memory", assets: { layers: {} }
 * };
 * ```
 */
export type ResolvedGameConfig = {
  /** The page, every field set. */
  page: Required<GameConfig["page"]>;
  /** The native app, or `undefined` for a game with no native build. */
  native: GameConfig["native"];
  /** The system plugins the shell wires. */
  system: readonly SystemName[];
  /** Where the save lives. */
  save: SaveKind;
  /** The asset build. */
  assets: { layers: Readonly<Record<string, string>> };
};

// ─── index.ts: the game as one data object ────────────────────

/**
 * The engine part of a screen app, in dependency order: the screen set, `audio`, `effects`,
 * `platform`. The game's features and plugins come after it.
 */
type ScreenSet = readonly [
  ...typeof screen,
  typeof audioPlugin,
  typeof effectsPlugin,
  typeof platformPlugin
];

/**
 * The screen app of a game whose own plugins are `Plugins`, as `createApp` types it.
 *
 * @example
 * ```ts
 * type App = ScreenAppOf<readonly [typeof scorePlugin]>; // app.ui, app.platform, app.score
 * ```
 */
export type ScreenAppOf<Plugins extends readonly AnyPluginInstance[]> = ReturnType<
  typeof createApp<[...ScreenSet, ...Plugins]>
>;

/**
 * The headless app of a game whose headless plugins are `Plugins`, as `createApp` types it.
 *
 * @example
 * ```ts
 * type App = HeadlessAppOf<readonly []>; // app.time, .lifecycle, .model, .clock, .flow, .log, .env
 * ```
 */
export type HeadlessAppOf<Plugins extends readonly AnyPluginInstance[]> = ReturnType<
  typeof createApp<[...Plugins]>
>;

/** Every `pluginConfigs` key of the screen app of a game, as `createApp` accepts them. */
type AllConfigs<Plugins extends readonly AnyPluginInstance[]> = NonNullable<
  NonNullable<Parameters<typeof createApp<[...ScreenSet, ...Plugins]>>[0]>["pluginConfigs"]
>;

/** The plugin configs the shell writes as a whole, or in part: they leave the game's type. */
type SeamOwned = "model" | "clock" | "platform" | "flow" | "renderer" | "assets" | "audio";

/**
 * The `pluginConfigs` a game writes in `defineGameApp`: every plugin of its screen app, without
 * the keys the shell writes from the seams. `clock` and `platform` are gone; `model` keeps
 * `schemaVersion` and `migrations`; `flow` loses `mainFlow` and `safeNode`; `renderer` loses
 * `mount`; `assets` loses `manifest` and `io`; `audio` loses `context`. A seam-owned key is a
 * compile error, never a value the shallow merge would drop.
 *
 * @example
 * ```ts
 * defineGameApp({ flow: mainFlow, player, session, pluginConfigs: { ui: { tapTargetPt: 48 } } }); // passes
 * defineGameApp({ flow: mainFlow, player, session, pluginConfigs: { clock: {} } }); // compile error: the shell owns clock
 * ```
 */
export type GamePluginConfigs<Plugins extends readonly AnyPluginInstance[] = readonly []> = Omit<
  AllConfigs<Plugins>,
  SeamOwned
> & {
  /** The save schema of the game. The shell writes the provider, the seed and the starting state. */
  model?: Pick<Partial<Model.Config>, "schemaVersion" | "migrations">;
  /** The runner limits. The shell writes `mainFlow` and `safeNode` from the definition. */
  flow?: Omit<Partial<Flow.Config>, "mainFlow" | "safeNode">;
  /** The canvas. The shell writes `mount`; a seam's `loadPixi` and `preference` win. */
  renderer?: Omit<Partial<Renderer.Config>, "mount">;
  /** The texture budget and the CDN prefix. The shell writes `manifest` and `io`. */
  assets?: Omit<Partial<Assets.Config>, "manifest" | "io">;
  /** Buses, volumes, music. The shell writes `context`; a seam's `journal` wins. */
  audio?: Omit<Partial<Audio.Config>, "context">;
};

/**
 * What `defineGameApp` takes: the whole game as one data object. Nothing here is a seam: the
 * clock, the save provider, the manifest and the platform come from `headless()` and `screen()`.
 *
 * @example
 * ```ts
 * // tests/fixtures/mini-game/index.ts
 * const definition: GameDefinition = {
 *   flow: mainFlow, safeNode: "home", player: { count: 0 }, session: { opened: 0 },
 *   features: [homeFeature, infoFeature], headless: { features: [infoFeature] }
 * };
 * ```
 */
export type GameDefinition<
  Plugins extends readonly AnyPluginInstance[] = readonly [],
  HeadlessPlugins extends readonly AnyPluginInstance[] = readonly [],
  Player extends Model.Json = Model.Json,
  Session extends Model.Json = Model.Json
> = {
  /** The main flow. */
  flow: Flow.AnyFlow;
  /** The checkpoint entered after a failed retry. Default: the start of the main flow. */
  safeNode?: string;
  /** The player a new save starts from. */
  player: Player;
  /** The session at every start. */
  session: Session;
  /** The long side the layout needs, in reference units. Default 1920. */
  referenceLong?: number;
  /** The rng seed of a new save. Default 42. */
  seed?: number;
  /** The shared layer: composed first among the features. */
  shared?: Flow.FeaturePlugin;
  /** The features of the screen app, in order, after `shared`. */
  features?: readonly Flow.FeaturePlugin[];
  /** The game's own plugins, after the features. Their APIs land on `screen().app`. */
  plugins?: Plugins;
  /** What the headless app composes: the logic of these features and these plugins, nothing else. */
  headless?: { features?: readonly Flow.FeaturePlugin[]; plugins?: HeadlessPlugins };
  /** Plugin configs of the game. Seam-owned keys are not accepted. */
  pluginConfigs?: NoInfer<GamePluginConfigs<Plugins>>;
};

/**
 * The in-memory save provider a seam gets when it passes none: it records every call.
 *
 * @example
 * ```ts
 * const { app, provider } = game.headless();
 * await createHeadless(app); // flow.run() loads the save and commits a new player at once
 * provider.calls.map(call => call.method); // ["load", "commit"]
 * ```
 */
export type MemoryProvider = ReturnType<typeof memory>;

/**
 * What one call of `headless()` or `screen()` gives: the app, not started, and the clock and save
 * provider it runs on, so a test can move the time and read the save.
 *
 * @example
 * ```ts
 * const { app, clock, provider } = game.headless({ seed: 7 });
 * ```
 */
export type GameHandle<App, Source, Provider> = {
  /**
   * The app, not started.
   *
   * @example
   * ```ts
   * const { app } = game.headless();
   * await app.start(); // the caller starts it, and runs the graph
   * ```
   */
  app: App;
  /**
   * The clock source the app runs on: the fake clock at `startMoment` unless a seam passed one.
   *
   * @example
   * ```ts
   * const { clock } = game.headless();
   * clock.advance(60_000); // clock.now() is 1060000
   * ```
   */
  clock: Source;
  /**
   * The save provider the app runs on: a fresh memory provider unless a seam passed one.
   *
   * @example
   * ```ts
   * const { provider } = game.headless();
   * provider.calls; // []: flow.run() loads the save, start() does not
   * ```
   */
  provider: Provider;
};

/**
 * What a test or the page may pin on a headless app. Every field is optional; the definition and
 * the engine defaults fill the rest.
 *
 * @example
 * ```ts
 * game.headless({ seed: 7, player: { count: 3 } });
 * ```
 */
export type HeadlessSeams<Player, Session, Source, Provider> = {
  /**
   * The rng seed of a new save. Default: the definition's seed, else 42.
   *
   * @example
   * ```ts
   * game.headless({ seed: 7 }); // a new save draws from seed 7
   * ```
   */
  seed?: number;
  /**
   * The clock source. Default: `fakeClock(startMoment)`; the page passes the device clock.
   *
   * @example
   * ```ts
   * game.headless({ clock: fakeClock(5000) }).clock.now(); // 5000
   * ```
   */
  clock?: Source;
  /**
   * The save provider. Default: a fresh `memory()`.
   *
   * @example
   * ```ts
   * game.headless({ provider: memory({ state: saveOf({ count: 3 }, 42), version: 1 }) }); // a returning player
   * ```
   */
  provider?: Provider;
  /**
   * The player a new save starts from. Default: the definition's player.
   *
   * @example
   * ```ts
   * game.headless({ player: { count: 3 } }); // a new save counts 3
   * ```
   */
  player?: Player;
  /**
   * The session at start. Default: the definition's session.
   *
   * @example
   * ```ts
   * game.headless({ session: { opened: 2 } });
   * ```
   */
  session?: Session;
};

/**
 * What a test or the page may pin on a screen app: the headless seams, and the manifest, the
 * file seam, the platform and the screen-on switch, the audio and the renderer seams.
 *
 * @example
 * ```ts
 * game.screen({ manifest: "/manifest.json", renderer: { mount: "#game" } });
 * ```
 */
export type ScreenSeams<Player, Session, Source, Provider> = HeadlessSeams<
  Player,
  Session,
  Source,
  Provider
> & {
  /**
   * The manifest the assets plugin reads: a URL on the page, the parsed file in a test.
   *
   * @example
   * ```ts
   * game.screen({ manifest: await readManifest() }); // tests/integration/mini-helpers.ts
   * ```
   */
  manifest?: string | Assets.Manifest;
  /**
   * The file seam of the assets plugin. Left out, the browser fetch, or headless in a test.
   *
   * @example
   * ```ts
   * game.screen({ manifest, io: folderIo().io }); // the fixture's files, read from disk
   * ```
   */
  io?: Assets.AssetsIo;
  /**
   * The platform provider. Left out, the platform plugin is inert and `back()` answers `"none"`.
   *
   * @example
   * ```ts
   * const { app } = game.screen({ platform: provider });
   * await app.start();
   * void app.flow.run();
   * app.platform.back(); // "exit" once the graph rests on Home: Home does not list "back"
   * ```
   */
  platform?: Platform.PlatformProvider;
  /**
   * Keeps the screen on while the game runs. Default `false`.
   *
   * @example
   * ```ts
   * await game.screen({ platform: provider, keepAwake: true }).app.start(); // provider.keepAwake(true)
   * ```
   */
  keepAwake?: boolean;
  /**
   * The audio seams: the context factory, and how many started sounds the journal keeps.
   *
   * @example
   * ```ts
   * game.screen({ audio: { context: () => fakeContext, journal: 200 } }); // the dev page keeps 200
   * ```
   */
  audio?: { context?: () => Audio.AudioContextLike; journal?: number };
  /**
   * The renderer seams: where the canvas goes, how Pixi loads, which backend it asks for.
   *
   * @example
   * ```ts
   * game.screen({ renderer: { mount: "#game", preference: "webgl" } }); // the page under ?renderer=webgl
   * ```
   */
  renderer?: {
    mount?: string | HTMLElement;
    loadPixi?: () => Promise<Renderer.PixiModule>;
    preference?: "webgpu" | "webgl";
  };
};

/**
 * The game, as `defineGameApp` returns it: two ways to make its app. `headless()` composes the
 * logic only, for tests; `screen()` composes the engine's screen set, the features and the game's
 * plugins, for the page and the screen tests. Neither starts the app.
 *
 * @example
 * ```ts
 * import game from "../index";
 * const { app, clock, provider } = game.headless({ seed: 7 });
 * ```
 */
export type GameApp<
  Plugins extends readonly AnyPluginInstance[] = readonly [],
  HeadlessPlugins extends readonly AnyPluginInstance[] = readonly [],
  Player extends Model.Json = Model.Json,
  Session extends Model.Json = Model.Json
> = {
  /**
   * Makes the logic app: the core plugins, the logic of `headless.features` and the
   * `headless.plugins`. No screen plugin, no game plugin unless listed. Each call gives a fresh
   * app, clock and provider.
   *
   * @param seams - What the test pins: seed, clock, provider, player, session.
   * @returns The app, not started, and its clock and provider.
   * @example
   * ```ts
   * const { app, clock } = game.headless({ seed: 7 });
   * clock.now(); // 1000000, the fake clock at startMoment
   * const run = await createHeadless(app);
   * run.state().path; // "home"
   * ```
   */
  headless<
    Source extends Clock.ClockSource = Clock.FakeClock,
    Provider extends Model.PlayerStateProvider = MemoryProvider
  >(
    seams?: HeadlessSeams<Player, Session, Source, Provider>
  ): GameHandle<HeadlessAppOf<HeadlessPlugins>, Source, Provider>;

  /**
   * Makes the screen app: the screen set, `audio`, `effects`, `platform`, then `shared`, the
   * features and the game's plugins, in that order. Without a mount the renderer is inert, so the
   * same app runs in a test. Each call gives a fresh app, clock and provider.
   *
   * @param seams - What the test or the page pins, the headless seams and the screen seams.
   * @returns The app, not started, and its clock and provider.
   * @example
   * ```ts
   * const { app } = game.screen({ manifest: await readManifest(), io: folderIo().io });
   * await app.start();
   * void app.flow.run(); // the page runs the graph; the mini game starts on its Home checkpoint
   * app.flow.state().path; // "home" once the runner rests
   * ```
   */
  screen<
    Source extends Clock.ClockSource = Clock.FakeClock,
    Provider extends Model.PlayerStateProvider = MemoryProvider
  >(
    seams?: ScreenSeams<Player, Session, Source, Provider>
  ): GameHandle<ScreenAppOf<Plugins>, Source, Provider>;
};

// ─── /app/page: the page that runs a game ─────────────────────

/**
 * Any game, whatever its plugins and state: what the page takes.
 *
 * @example
 * ```ts
 * const page: AnyGameApp = game; // the default export of a game's index.ts
 * ```
 */
export type AnyGameApp = GameApp<
  readonly AnyPluginInstance[],
  readonly AnyPluginInstance[],
  Model.Json,
  Model.Json
>;

/**
 * The screen app of a game, as `game.screen().app` types it.
 *
 * @example
 * ```ts
 * type MiniApp = ScreenAppOfGame<typeof game>; // has app.flow, app.ui, app.platform
 * ```
 */
export type ScreenAppOfGame<Game extends AnyGameApp> = ReturnType<Game["screen"]>["app"];

/**
 * One prepared save of the dev page, picked with `?player=<name>`: the default export of
 * `tests/scenarios/<name>.ts`. It gets the device time, so a timer can be due already.
 *
 * @example
 * ```ts
 * // tests/scenarios/full.ts of a game: `?player=full` opens on a full board, a refill due in 60 s.
 * const full: Scenario<Player> = now => ({ player: { ...startingPlayer, board: fullBoard, refillAt: now + 60_000 } });
 * export default full;
 * ```
 */
export type Scenario<Player = Model.Json, Session = Model.Json> = (now: number) => {
  player: Player;
  session?: Session;
};

/**
 * A dev agent the page starts after the app: the default export of an agent module the CLI names,
 * the editor's among them. It gets the running app, the page title and the game's `.dev` modules.
 *
 * @example
 * ```ts
 * // .moku/main.ts, written by moku-game dev: the editor's agent module's default export.
 * await startPage(game, config, { agents: [agent0] }); // agent0({ app, name: "mini-game", modules: [] })
 * ```
 */
export type PageAgent<App = ScreenAppOfGame<AnyGameApp>> = (page: {
  app: App;
  name: string;
  modules: readonly object[];
}) => void | Promise<void>;

/**
 * Builds the system shell from the resolved config: the type of `systemShell` of
 * `@moku-labs/game/app/system`. The page reaches the shell only through this.
 *
 * @example
 * ```ts
 * await startPage(game, config, { system: systemShell }); // systemShell is a SystemShellFactory
 * ```
 */
export type SystemShellFactory = (
  config: ResolvedGameConfig,
  report: (problem: string) => void
) => Promise<SystemShell>;

/**
 * What the generated `.moku/main.ts` hands the page besides the game and its config.
 *
 * @example
 * ```ts
 * const options: PageOptions = { scenarios: { ready }, system: systemShell, agents: [agent0], devModules: [devModule0] };
 * ```
 */
export type PageOptions = {
  /** Prepared saves by name, for `?player=`. Dev only; the build passes none. */
  scenarios?: Readonly<Record<string, Scenario>>;
  /** The system shell factory, when `config.ts` names a system plugin or the store save. */
  system?: SystemShellFactory;
  /** Agents started after the app. Dev only. */
  agents?: readonly PageAgent[];
  /** The game's `.dev` modules, handed to the agents. Dev only. */
  devModules?: readonly object[];
};

/**
 * What `startPage` resolves to: the running screen app, and the system app for
 * `globalThis.system` (`undefined` without a shell).
 *
 * @example
 * ```ts
 * const { app } = await startPage(game, config);
 * app.flow.state().path; // "home" once the runner rests
 * ```
 */
export type StartedPage<Game extends AnyGameApp> = {
  /** The screen app, started. */
  app: ScreenAppOfGame<Game>;
  /** The `@moku-labs/system` app, or `undefined` without a shell. Typed `unknown`: see `SystemShell.handle`. */
  system: unknown;
};

// ─── /app/system: the native shell ────────────────────────────

/**
 * The system shell: the `@moku-labs/system` app the config names, and what the engine takes from
 * it. `systemShell` builds it; the page starts it before the game and stops it after.
 *
 * @example
 * ```ts
 * const shell = await systemShell(resolveConfig(config), problem => problems.push(problem));
 * game.screen({ platform: shell.platform, provider: shell.save });
 * ```
 */
export type SystemShell = {
  /**
   * The `@moku-labs/system` app, for `globalThis.system`. Typed `unknown`: a system type here
   * would land in the `.d.mts` of every game and break the typecheck of a web-only one.
   *
   * @example
   * ```ts
   * Reflect.set(globalThis, "system", shell.handle); // e2e: system.haptics.selection()
   * ```
   */
  handle: unknown;
  /**
   * The engine's platform provider over the system app. A capability the config does not name is
   * inert.
   *
   * @example
   * ```ts
   * shell.platform.haptic("success"); // the shell plays system.haptics.notify("success")
   * ```
   */
  platform: Platform.PlatformProvider;
  /**
   * The save provider over the system store, set when `config.save` is `"store"`.
   *
   * @example
   * ```ts
   * game.screen({ provider: shell.save }); // the save survives a restart of the native app
   * ```
   */
  save: Model.PlayerStateProvider | undefined;
  /**
   * Starts the system app. The page starts it before the game, so keep-awake finds it running.
   *
   * @returns Resolves when the system app runs.
   * @example
   * ```ts
   * await shell.start();
   * await app.start();
   * ```
   */
  start(): Promise<void>;
  /**
   * Stops the system app.
   *
   * @returns Resolves when the system app stopped.
   * @example
   * ```ts
   * await app.stop();
   * await shell.stop();
   * ```
   */
  stop(): Promise<void>;
};
