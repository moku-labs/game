/**
 * @file `defineGameApp`: what `headless()` and `screen()` compose, in which order, and the plugin
 * configs they hand `createApp`. `createApp` of the engine root is wrapped in a spy that still
 * creates the real app, so a test reads exactly what the composition passed.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineGameApp, startMoment } from "../../../src/app/define";
import type { Assets, Flow, Model, Platform } from "../../../src/index";
import { createApp, createPlugin, defineFeature, flowPlugin, type } from "../../../src/index";
import { defineFlow, defineNode } from "../../../src/plugins/flow/runner/define";

vi.mock("../../../src/index", async importOriginal => {
  const engine = await importOriginal<typeof import("../../../src/index")>();

  return { ...engine, createApp: vi.fn(engine.createApp) };
});

afterEach(() => {
  vi.mocked(createApp).mockClear();
});

/** The options `createApp` was last called with. */
type AppOptions = {
  plugins?: readonly { name: string }[];
  config?: { referenceLong?: number };
  pluginConfigs?: Record<string, Record<string, unknown>>;
};

/**
 * Reads what the composition passed to `createApp` on its last call.
 *
 * @returns The options of the last call.
 */
function lastOptions(): AppOptions {
  const call = vi.mocked(createApp).mock.lastCall;

  if (call === undefined) throw new Error("createApp was not called");

  return call[0] as AppOptions;
}

/**
 * Reads the plugin configs of the last `createApp` call.
 *
 * @returns The plugin configs, by plugin name.
 */
function lastConfigs(): Record<string, Record<string, unknown>> {
  return lastOptions().pluginConfigs ?? {};
}

const home = defineNode({ rest: true, outcomes: { play: type() } });
const mainFlow = defineFlow("main", {
  nodes: { home },
  start: "home",
  edges: { home: { play: "home" } }
});
const sharedFeature = defineFeature("shared", {});
const homeFeature = defineFeature("homeScreen", { nodes: [home] });
const rewardFeature = defineFeature("reward", {});

/** A game plugin with a config and an API, as a game writes one. */
const scorePlugin = createPlugin("score", {
  depends: [flowPlugin],
  config: { start: 0 },
  api: ctx => ({ start: () => ctx.config.start })
});

/** Removes nothing: the remover of a subscription that holds nothing. */
const removeNothing = (): void => undefined;

/** A provider that answers nothing, for the platform seam. */
const provider: Platform.PlatformProvider = {
  onPause: () => removeNothing,
  onResume: () => removeNothing,
  onBack: () => removeNothing,
  haptic: removeNothing,
  keepAwake: removeNothing,
  exit: removeNothing
};

/**
 * The error `defineGameApp` throws for a list entry that is not a feature.
 *
 * @param path - The list and index.
 * @returns The expected error.
 */
function notAFeature(path: string): Error {
  return new Error(
    `[game] defineGameApp: ${path} is not a feature.\n  Make it with defineFeature(name, description).`
  );
}

/** An empty manifest, for the manifest seam. */
const manifest: Assets.Manifest = { version: 1, bundles: {} };

/** The starting player of the test game. */
const player = { count: 0 };

/** The session at every start of the test game. */
const session = { opened: 0 };

describe("headless", () => {
  it("headless composes the logic-only features and listed plugins only", () => {
    const game = defineGameApp({
      flow: mainFlow,
      player,
      session,
      features: [homeFeature, rewardFeature],
      plugins: [scorePlugin],
      headless: { features: [rewardFeature], plugins: [scorePlugin] }
    });
    const { app } = game.headless();
    const plugins = lastOptions().plugins ?? [];

    expect(plugins).toHaveLength(2);
    expect(plugins[0]).toBe(rewardFeature.logicOnly);
    expect(plugins[1]).toBe(scorePlugin);
    expect(app.has("reward")).toBe(true);
    expect(app.has("homeScreen")).toBe(false);
    expect(app.has("renderer")).toBe(false);
    expect(app.score.start()).toBe(0);
  });

  it("headless drops plugin configs of plugins it does not compose", () => {
    const pluginConfigs = {
      time: { maxFps: 30 as const },
      ui: { tapTargetPt: 48 },
      score: { start: 5 },
      log: { mode: "silent" as const }
    };
    const without = defineGameApp({
      flow: mainFlow,
      player,
      session,
      plugins: [scorePlugin],
      pluginConfigs
    });

    without.headless();
    expect(Object.keys(lastConfigs()).toSorted()).toEqual([
      "clock",
      "flow",
      "log",
      "model",
      "time"
    ]);
    expect(lastConfigs().time).toEqual({ maxFps: 30 });

    const listed = defineGameApp({
      flow: mainFlow,
      player,
      session,
      plugins: [scorePlugin],
      headless: { plugins: [scorePlugin] },
      pluginConfigs
    });
    const { app } = listed.headless();

    expect(lastConfigs().score).toEqual({ start: 5 });
    expect(lastConfigs().ui).toBeUndefined();
    expect(app.score.start()).toBe(5);
  });

  it("headless defaults to a memory provider and the fake clock at startMoment", async () => {
    const game = defineGameApp({ flow: mainFlow, player, session });
    const { app, clock, provider: save } = game.headless();

    expect(clock.now()).toBe(startMoment);
    expect(save.calls).toEqual([]);
    expect(lastConfigs().clock).toEqual({ source: clock });
    expect(lastConfigs().model?.playerProvider).toBe(save);

    await app.start();
    clock.advance(60_000);
    expect(app.clock.now()).toBe(startMoment + 60_000);
    // flow.run() loads the save at the start of the graph; a test without the graph loads by hand.
    await app.model.store.load();
    expect(save.calls[0]).toEqual({ method: "load" });
    expect(app.model.store.snapshot().player).toEqual(player);
    expect(app.model.store.snapshot().session).toEqual(session);
    await app.stop();
  });

  it("headless seeds 42 unless the definition or the seam names a seed", async () => {
    const game = defineGameApp({ flow: mainFlow, player, session });
    const seeded = defineGameApp({ flow: mainFlow, player, session, seed: 9 });

    game.headless();
    expect(lastConfigs().model?.seed).toBe(42);
    seeded.headless();
    expect(lastConfigs().model?.seed).toBe(9);
    seeded.headless({ seed: 7 });
    expect(lastConfigs().model?.seed).toBe(7);

    const { app } = game.headless({ seed: 7 });

    await app.start();
    expect(app.model.store.snapshot().rng.seed).toBe(7);
    await app.stop();
  });

  it("headless takes the player and the session of the seams over the definition's", () => {
    const game = defineGameApp({ flow: mainFlow, player, session });

    game.headless({ player: { count: 3 }, session: { opened: 2 } });
    expect(lastConfigs().model).toMatchObject({
      initialPlayer: { count: 3 },
      initialSession: { opened: 2 }
    });
  });
});

describe("screen", () => {
  it("screen composes the engine set, shared, features, then plugins in order", () => {
    const game = defineGameApp({
      flow: mainFlow,
      player,
      session,
      shared: sharedFeature,
      features: [homeFeature, rewardFeature],
      plugins: [scorePlugin]
    });
    const { app } = game.screen();

    expect((lastOptions().plugins ?? []).map(plugin => plugin.name)).toEqual([
      "world",
      "renderer",
      "input",
      "assets",
      "scenes",
      "anim",
      "i18n",
      "text",
      "ui",
      "audio",
      "effects",
      "platform",
      "shared",
      "homeScreen",
      "reward",
      "score"
    ]);
    expect(app.score.start()).toBe(0);
  });

  it("screen leaves shared out when the definition has none", () => {
    const game = defineGameApp({ flow: mainFlow, player, session });

    game.screen();
    expect((lastOptions().plugins ?? []).map(plugin => plugin.name).at(-1)).toBe("platform");
  });

  it("screen merges seam keys over game keys per plugin and keeps the rest", () => {
    const migration = { from: 1, up: (state: Model.Json) => state };
    const game = defineGameApp({
      flow: mainFlow,
      safeNode: "home",
      player,
      session,
      plugins: [scorePlugin],
      pluginConfigs: {
        model: { schemaVersion: 2, migrations: [migration] },
        flow: { retries: 3 },
        renderer: { background: 0x10_10_18, preference: "webgpu" },
        assets: { textureBudgetMb: 64 },
        audio: { musicFadeMs: 400, journal: 10 },
        ui: { tapTargetPt: 48 },
        score: { start: 5 }
      }
    });
    const { clock, provider: save } = game.screen({
      manifest,
      platform: provider,
      keepAwake: true,
      renderer: { mount: "#game", preference: "webgl" },
      audio: { journal: 200 }
    });
    const configs = lastConfigs();

    expect(configs.model).toEqual({
      schemaVersion: 2,
      migrations: [migration],
      playerProvider: save,
      initialPlayer: player,
      initialSession: session,
      seed: 42
    });
    expect(configs.clock).toEqual({ source: clock });
    expect(configs.flow).toEqual({ retries: 3, mainFlow, safeNode: "home" });
    expect(configs.platform).toEqual({ provider, keepAwake: true });
    expect(configs.renderer).toEqual({
      background: 0x10_10_18,
      preference: "webgl",
      mount: "#game"
    });
    expect(configs.assets).toEqual({ textureBudgetMb: 64, manifest, io: undefined });
    expect(configs.audio).toEqual({ musicFadeMs: 400, journal: 200 });
    expect(configs.ui).toEqual({ tapTargetPt: 48 });
    expect(configs.score).toEqual({ start: 5 });
  });

  it("a seam left undefined never erases a game value", () => {
    const game = defineGameApp({
      flow: mainFlow,
      player,
      session,
      pluginConfigs: {
        renderer: { preference: "webgpu", antialias: true },
        audio: { journal: 10 }
      }
    });

    game.screen({
      // @ts-expect-error -- a game in JavaScript may pass undefined; the type refuses it.
      renderer: { mount: "#game", preference: undefined },
      audio: {}
    });
    expect(lastConfigs().renderer).toEqual({
      preference: "webgpu",
      antialias: true,
      mount: "#game"
    });
    expect(lastConfigs().audio).toEqual({ journal: 10 });

    game.screen();
    expect(lastConfigs().renderer).toEqual({ preference: "webgpu", antialias: true });
    expect(lastConfigs().audio).toEqual({ journal: 10 });
    expect(lastConfigs().platform).toEqual({ provider: undefined, keepAwake: false });
  });

  it("model keeps the game's schemaVersion and migrations", () => {
    const migration = { from: 1, up: (state: Model.Json) => state };
    const game = defineGameApp({
      flow: mainFlow,
      player,
      session,
      pluginConfigs: { model: { schemaVersion: 2, migrations: [migration] } }
    });

    game.headless();
    expect(lastConfigs().model).toMatchObject({ schemaVersion: 2, migrations: [migration] });
    game.screen();
    expect(lastConfigs().model).toMatchObject({ schemaVersion: 2, migrations: [migration] });
  });

  it("referenceLong reaches the engine config only when the definition sets it", () => {
    defineGameApp({ flow: mainFlow, player, session }).screen();
    expect(lastOptions().config).toBeUndefined();

    defineGameApp({ flow: mainFlow, player, session, referenceLong: 2100 }).headless();
    expect(lastOptions().config).toEqual({ referenceLong: 2100 });
  });
});

describe("defineGameApp", () => {
  it("two calls give two providers and two clocks", () => {
    const game = defineGameApp({ flow: mainFlow, player, session });
    const first = game.headless();
    const second = game.headless();
    const screenApp = game.screen();

    expect(second.provider).not.toBe(first.provider);
    expect(second.clock).not.toBe(first.clock);
    expect(screenApp.provider).not.toBe(first.provider);
    expect(second.app).not.toBe(first.app);
    first.clock.advance(5000);
    expect(second.clock.now()).toBe(startMoment);
  });

  it("creates no app until headless() or screen() is called", () => {
    defineGameApp({ flow: mainFlow, player, session });
    expect(createApp).not.toHaveBeenCalled();
  });

  it("defineGameApp refuses a missing flow", () => {
    expect(() =>
      // @ts-expect-error -- flow is required; a game in JavaScript may leave it out.
      defineGameApp({ player, session })
    ).toThrow(
      new Error(
        "[game] defineGameApp needs flow.\n  Pass the main flow: defineGameApp({ flow: mainFlow, ... })."
      )
    );
  });

  it("defineGameApp names the list and index of a non-feature", () => {
    // A plain plugin in a feature list: a game in JavaScript, or one that casts.
    const notFeature = scorePlugin as unknown as Flow.FeaturePlugin;

    expect(() =>
      defineGameApp({
        flow: mainFlow,
        player,
        session,
        features: [homeFeature, rewardFeature, notFeature]
      })
    ).toThrow(notAFeature("features[2]"));
    expect(() =>
      defineGameApp({
        flow: mainFlow,
        player,
        session,
        headless: { features: [notFeature] }
      })
    ).toThrow(notAFeature("headless.features[0]"));
    expect(() => defineGameApp({ flow: mainFlow, player, session, shared: notFeature })).toThrow(
      notAFeature("shared")
    );
  });
});
