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
  GamePluginConfigs,
  MemoryProvider,
  ScreenAppOfGame
} from "../../../src/app/types";
import type { Clock, Model } from "../../../src/index";
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
      ReturnType<typeof game.screen>["app"]
    >();
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
