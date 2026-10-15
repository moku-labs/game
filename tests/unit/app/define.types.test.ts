/**
 * @file The types of `defineGameApp`, checked by `tsc`: the plugin tuples, the player and the
 * session are inferred from the one object with no generic at the call site, a seam-owned plugin
 * config key is a compile error, and the seams type the clock and the provider a test reads. Each
 * `@ts-expect-error` fails the build in both directions: the mistake must error, and a correct line
 * under one would be reported as an unused directive. The calls also run, so nothing here throws.
 */
import { describe, expectTypeOf, it } from "vitest";
import { defineGameApp } from "../../../src/app/define";
import type {
  AnyGameApp,
  GameApp,
  GameDefinition,
  GamePluginConfigs,
  MemoryProvider,
  ScreenAppOf,
  ScreenAppOfGame,
  WithGameState
} from "../../../src/app/types";
import type { Clock, Flow, I18n, Model } from "../../../src/index";
import { createPlugin, defineFeature, flowPlugin, type } from "../../../src/index";
import { fakeClock } from "../../../src/plugins/clock/fake";
import { systemSource } from "../../../src/plugins/clock/system";
import { defineFlow, defineNode } from "../../../src/plugins/flow/runner/define";
import { memory } from "../../../src/plugins/model/store/providers/memory";

type Player = { count: number };
type Session = { opened: number };

const home = defineNode({ rest: true, outcomes: { play: type() } });
const mainFlow = defineFlow("main", {
  nodes: { home },
  start: "home",
  edges: { home: { play: "home" } }
});
const rewardFeature = defineFeature("reward", {});
const player: Player = { count: 0 };
const session: Session = { opened: 0 };

/** A game plugin with a config and an API. */
const scorePlugin = createPlugin("score", {
  depends: [flowPlugin],
  config: { start: 0 },
  api: ctx => ({ start: () => ctx.config.start })
});

/** A second game plugin, listed for the headless app only. */
const auditPlugin = createPlugin("audit", {
  depends: [flowPlugin],
  api: () => ({ count: (): number => 1 })
});

const game = defineGameApp({
  flow: mainFlow,
  player,
  session,
  features: [rewardFeature],
  plugins: [scorePlugin],
  headless: { features: [rewardFeature], plugins: [auditPlugin] }
});

describe("defineGameApp infers the game from the object", () => {
  it("captures the plugin tuples, the player and the session with no call-site generic", () => {
    expectTypeOf(game).toEqualTypeOf<
      GameApp<readonly [typeof scorePlugin], readonly [typeof auditPlugin], Player, Session>
    >();
  });

  it("screen().app has the game plugin APIs; headless().app has none of the screen APIs", () => {
    const screenApp = game.screen().app;
    const headlessApp = game.headless().app;

    expectTypeOf(screenApp.score.start).toEqualTypeOf<() => number>();
    expectTypeOf(screenApp).toHaveProperty("renderer");
    expectTypeOf(screenApp).toHaveProperty("platform");
    expectTypeOf(screenApp).toHaveProperty("flow");
    expectTypeOf(screenApp).not.toHaveProperty("audit");
    expectTypeOf(headlessApp.audit.count).toEqualTypeOf<() => number>();
    expectTypeOf(headlessApp).toHaveProperty("model");
    expectTypeOf(headlessApp).not.toHaveProperty("renderer");
    expectTypeOf(headlessApp).not.toHaveProperty("ui");
    expectTypeOf(headlessApp).not.toHaveProperty("score");
  });

  it("a game with no plugins has the engine APIs only", () => {
    const bare = defineGameApp({ flow: mainFlow, player, session });

    expectTypeOf(bare).toEqualTypeOf<GameApp<readonly [], readonly [], Player, Session>>();
    expectTypeOf(bare.screen().app).toHaveProperty("ui");
    expectTypeOf(bare.headless().app).not.toHaveProperty("ui");
  });

  it("a game is an AnyGameApp, the type the page takes", () => {
    expectTypeOf(game).toExtend<AnyGameApp>();
    expectTypeOf<ScreenAppOfGame<typeof game>>().toEqualTypeOf<
      WithGameState<ScreenAppOf<readonly [typeof scorePlugin]>, Player, Session>
    >();
  });

  it("headless().app and screen().app read the committed snapshot typed by the game", () => {
    type HeadlessApp = ReturnType<typeof game.headless>["app"];
    type ScreenApp = ReturnType<typeof game.screen>["app"];
    type HeadlessSnapshot = ReturnType<HeadlessApp["model"]["store"]["snapshot"]>;

    expectTypeOf<HeadlessSnapshot["player"]>().toEqualTypeOf<Player>();
    expectTypeOf<HeadlessSnapshot["session"]>().toEqualTypeOf<Session>();
    expectTypeOf<
      ReturnType<ScreenApp["model"]["store"]["snapshot"]>["player"]["count"]
    >().toEqualTypeOf<number>();

    // Every other member of the store stays the engine's.
    expectTypeOf<HeadlessApp["model"]["store"]["load"]>().toEqualTypeOf<Model.StoreApi["load"]>();

    // Built here, never called: the app is not started, so its store holds no snapshot yet.
    const coinsOf = (app: HeadlessApp) =>
      // @ts-expect-error -- the player of this game has no `coins`
      app.model.store.snapshot().player.coins;

    expectTypeOf(coinsOf).toBeFunction();
  });
});

/** What `moku-game keys` writes for a game with one key that takes parameters and one that does not. */
type GameStrings = { "hud.orders": { n: number }; "toast.saved": Record<string, never> };

/**
 * Reads the strings tag of a definition, inferring the table the way `defineGameApp` does.
 *
 * @param definition - The game.
 * @returns The tag the definition carries, typed by the inferred table.
 */
function stringsOf<Strings extends I18n.StringTable>(
  definition: GameDefinition<readonly [], readonly [], Player, Session, Strings>
): Flow.TypeTag<Strings> | undefined {
  return definition.strings;
}

describe("app.i18n.isKey is typed by the game's strings", () => {
  it("the screen app of a game with strings narrows isKey to the game's TextKey; without strings to string", () => {
    type TypedApp = ReturnType<
      GameApp<readonly [], readonly [], Player, Session, GameStrings>["screen"]
    >["app"];
    type WideApp = ReturnType<typeof game.screen>["app"];

    const savedOf = (app: TypedApp, value: unknown) => (app.i18n.isKey(value) ? value : undefined);
    const wideOf = (app: WideApp, value: unknown) => (app.i18n.isKey(value) ? value : undefined);

    expectTypeOf<ReturnType<typeof savedOf>>().toEqualTypeOf<"toast.saved" | undefined>();
    expectTypeOf<ReturnType<typeof wideOf>>().toEqualTypeOf<string | undefined>();

    // Every other member of app.i18n and the typed snapshot stay as they were.
    expectTypeOf<TypedApp["i18n"]["format"]>().toEqualTypeOf<I18n.I18nApi["format"]>();
    expectTypeOf<
      ReturnType<TypedApp["model"]["store"]["snapshot"]>["player"]
    >().toEqualTypeOf<Player>();

    // A game with strings is still a game the page takes.
    expectTypeOf<
      GameApp<readonly [], readonly [], Player, Session, GameStrings>
    >().toExtend<AnyGameApp>();
  });

  it("the definition carries the table as a type tag: strings: type<Strings>()", () => {
    expectTypeOf(
      stringsOf({ flow: mainFlow, player, session, strings: type<GameStrings>() })
    ).toEqualTypeOf<Flow.TypeTag<GameStrings> | undefined>();
    expectTypeOf(stringsOf({ flow: mainFlow, player, session })).toEqualTypeOf<
      Flow.TypeTag<I18n.StringTable> | undefined
    >();
  });

  it("defineGameApp with strings: type<Strings>() narrows app.i18n.isKey with no generic at the call", () => {
    const typed = defineGameApp({ flow: mainFlow, player, session, strings: type<GameStrings>() });
    const keyOf = (value: unknown) => (typed.screen().app.i18n.isKey(value) ? value : undefined);

    expectTypeOf<ReturnType<typeof keyOf>>().toEqualTypeOf<"toast.saved" | undefined>();
  });
});

describe("the design frame", () => {
  it("takes orientation and referenceSide; refuses page.orientation's any and a string side", () => {
    defineGameApp({
      flow: mainFlow,
      player,
      session,
      orientation: "landscape",
      referenceSide: 390
    });

    // Both throw at run time (define.test.ts): built here, never called, for their types only.
    const anyOrientation = () =>
      // @ts-expect-error -- "any" belongs to page.orientation of config.ts
      defineGameApp({ flow: mainFlow, player, session, orientation: "any" });
    const stringSide = () =>
      // @ts-expect-error -- a number of reference units
      defineGameApp({ flow: mainFlow, player, session, referenceSide: "390" });

    expectTypeOf(anyOrientation).toBeFunction();
    expectTypeOf(stringSide).toBeFunction();
  });
});

describe("pluginConfigs", () => {
  it("pluginConfigs refuses model.playerProvider, clock, platform, flow.mainFlow, renderer.mount, assets.manifest, audio.context", () => {
    const base = { flow: mainFlow, player, session, plugins: [scorePlugin] } as const;

    defineGameApp({
      ...base,
      // @ts-expect-error -- the shell writes the save provider from the seams
      pluginConfigs: { model: { playerProvider: memory() } }
    });
    defineGameApp({
      ...base,
      // @ts-expect-error -- the shell writes the clock source from the seams
      pluginConfigs: { clock: {} }
    });
    defineGameApp({
      ...base,
      // @ts-expect-error -- the shell writes the platform provider from the seams
      pluginConfigs: { platform: { keepAwake: true } }
    });
    defineGameApp({
      ...base,
      // @ts-expect-error -- the shell writes the main flow from the definition
      pluginConfigs: { flow: { mainFlow } }
    });
    defineGameApp({
      ...base,
      // @ts-expect-error -- the shell writes the mount from the seams
      pluginConfigs: { renderer: { mount: "#game" } }
    });
    defineGameApp({
      ...base,
      // @ts-expect-error -- the shell writes the manifest from the seams
      pluginConfigs: { assets: { manifest: "/manifest.json" } }
    });
    defineGameApp({
      ...base,
      // @ts-expect-error -- the shell writes the audio context from the seams
      pluginConfigs: { audio: { context: () => new AudioContext() } }
    });

    type Configs = GamePluginConfigs<readonly [typeof scorePlugin]>;

    expectTypeOf<Configs>().not.toHaveProperty("clock");
    expectTypeOf<Configs>().not.toHaveProperty("platform");
    expectTypeOf<keyof NonNullable<Configs["model"]>>().toEqualTypeOf<
      "schemaVersion" | "migrations"
    >();
    expectTypeOf<NonNullable<Configs["flow"]>>().not.toHaveProperty("mainFlow");
    expectTypeOf<NonNullable<Configs["renderer"]>>().not.toHaveProperty("mount");
    expectTypeOf<NonNullable<Configs["assets"]>>().not.toHaveProperty("manifest");
    expectTypeOf<NonNullable<Configs["audio"]>>().not.toHaveProperty("context");
  });

  it("pluginConfigs accepts model.migrations, flow.retries, ui.tapTargetPt and a game plugin's config", () => {
    const configured = defineGameApp({
      flow: mainFlow,
      player,
      session,
      plugins: [scorePlugin],
      pluginConfigs: {
        model: { schemaVersion: 2, migrations: [{ from: 1, up: state => state }] },
        flow: { retries: 3 },
        renderer: { preference: "webgl", background: 0x10_16_1d },
        audio: { journal: 50, musicFadeMs: 400 },
        ui: { tapTargetPt: 48 },
        score: { start: 5 }
      }
    });

    expectTypeOf(configured.screen().app.score.start).toEqualTypeOf<() => number>();
  });

  it("pluginConfigs refuses the config of a plugin the game does not compose", () => {
    defineGameApp({
      flow: mainFlow,
      player,
      session,
      // @ts-expect-error -- scorePlugin is not in plugins
      pluginConfigs: { score: { start: 5 } }
    });

    expectTypeOf<GamePluginConfigs>().not.toHaveProperty("score");
    expectTypeOf<GamePluginConfigs<readonly [typeof scorePlugin]>>().toHaveProperty("score");
  });
});

describe("seams", () => {
  it("headless().clock is FakeClock and screen({ clock: source }).clock is the source type", () => {
    expectTypeOf(game.headless().clock).toEqualTypeOf<Clock.FakeClock>();
    expectTypeOf(game.headless().provider).toEqualTypeOf<MemoryProvider>();
    expectTypeOf(game.screen().clock).toEqualTypeOf<Clock.FakeClock>();
    expectTypeOf(game.screen({ clock: systemSource() }).clock).toEqualTypeOf<Clock.ClockSource>();
    expectTypeOf(game.headless({ clock: fakeClock(5000) }).clock).toEqualTypeOf<Clock.FakeClock>();

    const custom: Model.PlayerStateProvider = memory();

    expectTypeOf(
      game.headless({ provider: custom }).provider
    ).toEqualTypeOf<Model.PlayerStateProvider>();
  });

  it("player seam must match the definition's player type", () => {
    game.headless({ player: { count: 3 }, session: { opened: 1 } });
    // @ts-expect-error -- count is a number in the definition's player
    game.headless({ player: { count: "3" } });
    // @ts-expect-error -- the session of the definition has no field named closed
    game.screen({ session: { closed: 1 } });

    expectTypeOf<NonNullable<Parameters<typeof game.headless>[0]>["player"]>().toEqualTypeOf<
      Player | undefined
    >();
  });

  it("screen takes the screen seams, headless does not", () => {
    game.screen({ keepAwake: true, renderer: { mount: "#game" }, audio: { journal: 200 } });
    // @ts-expect-error -- a headless app has no renderer
    game.headless({ renderer: { mount: "#game" } });

    expectTypeOf<NonNullable<Parameters<typeof game.screen>[0]>>().toHaveProperty("renderer");
    expectTypeOf<NonNullable<Parameters<typeof game.headless>[0]>>().not.toHaveProperty("renderer");
  });
});
