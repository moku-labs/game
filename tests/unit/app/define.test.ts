/**
 * @file `defineGameApp`: what `headless()` and `screen()` compose, in which order, and the plugin
 * configs they hand `createApp`. `createApp` of the engine root is wrapped in a spy that still
 * creates the real app, so a test reads exactly what the composition passed.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineGameApp, startMoment } from "../../../src/app/define";
import type { Assets, Flow, Model, Platform } from "../../../src/index";
import { createApp, createPlugin, defineFeature, flowPlugin, type } from "../../../src/index";
import { systemSource } from "../../../src/plugins/clock/system";
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
  config?: { orientation?: string; referenceSide?: number; referenceLong?: number };
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

  it("headless composes the logic of features when the definition has no headless key", () => {
    const game = defineGameApp({
      flow: mainFlow,
      player,
      session,
      shared: sharedFeature,
      features: [homeFeature, rewardFeature],
      plugins: [scorePlugin]
    });
    const { app } = game.headless();

    const plugins = lastOptions().plugins ?? [];

    expect(plugins).toHaveLength(2);
    expect(plugins[0]).toBe(homeFeature.logicOnly);
    expect(plugins[1]).toBe(rewardFeature.logicOnly);
    expect(app.has("homeScreen")).toBe(true);
    expect(app.has("reward")).toBe(true);
    // The default covers `features` only: `shared` and the game's plugins stay out, as before.
    expect(app.has("shared")).toBe(false);
    expect(app.has("score")).toBe(false);
  });

  it("an explicit headless.features list wins over features", () => {
    const game = defineGameApp({
      flow: mainFlow,
      player,
      session,
      features: [homeFeature, rewardFeature],
      headless: { features: [rewardFeature] }
    });
    const { app } = game.headless();

    const plugins = lastOptions().plugins ?? [];

    expect(plugins).toHaveLength(1);
    expect(plugins[0]).toBe(rewardFeature.logicOnly);
    expect(app.has("homeScreen")).toBe(false);
  });

  it("an explicit empty headless.features list composes no feature", () => {
    const game = defineGameApp({
      flow: mainFlow,
      player,
      session,
      features: [homeFeature, rewardFeature],
      headless: { features: [] }
    });
    const { app } = game.headless();

    expect(lastOptions().plugins).toEqual([]);
    expect(app.has("homeScreen")).toBe(false);
    expect(app.has("reward")).toBe(false);
  });

  it("headless.plugins without headless.features still gets the logic of features", () => {
    const game = defineGameApp({
      flow: mainFlow,
      player,
      session,
      features: [homeFeature, rewardFeature],
      plugins: [scorePlugin],
      headless: { plugins: [scorePlugin] }
    });
    const { app } = game.headless();

    const plugins = lastOptions().plugins ?? [];

    expect(plugins).toHaveLength(3);
    expect(plugins[0]).toBe(homeFeature.logicOnly);
    expect(plugins[1]).toBe(rewardFeature.logicOnly);
    expect(plugins[2]).toBe(scorePlugin);
    expect(app.has("homeScreen")).toBe(true);
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
    // The headless app never adapts its frame rate (spec 21 G8.2).
    expect(lastConfigs().time).toEqual({ maxFps: 30, adaptive: false });

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

  it("the frame keys reach the engine config only when the definition sets them", () => {
    defineGameApp({ flow: mainFlow, player, session }).headless();
    expect(lastOptions()).not.toHaveProperty("config");

    defineGameApp({ flow: mainFlow, player, session, referenceSide: 390 }).headless();
    expect(lastOptions().config).toEqual({ referenceSide: 390 });

    defineGameApp({ flow: mainFlow, player, session, orientation: "landscape" }).screen();
    expect(lastOptions().config).toEqual({ orientation: "landscape" });

    const framed = defineGameApp({
      flow: mainFlow,
      player,
      session,
      orientation: "landscape",
      referenceSide: 390,
      referenceLong: 763
    });
    const frame = { orientation: "landscape", referenceSide: 390, referenceLong: 763 };

    framed.headless();
    expect(lastOptions().config).toEqual(frame);
    framed.screen();
    expect(lastOptions().config).toEqual(frame);
  });

  it("a screen app lays out in the definition's frame", async () => {
    const portrait = defineGameApp({
      flow: mainFlow,
      player,
      session,
      referenceSide: 390
    }).screen();

    await portrait.app.start();
    expect(portrait.app.renderer.viewport.size()).toMatchObject({
      width: 390,
      height: 520,
      orientation: "portrait"
    });
    await portrait.app.stop();

    const landscape = defineGameApp({
      flow: mainFlow,
      player,
      session,
      orientation: "landscape",
      referenceSide: 390
    }).screen();

    await landscape.app.start();
    expect(landscape.app.renderer.viewport.size()).toMatchObject({
      width: 520,
      height: 390,
      orientation: "landscape"
    });
    await landscape.app.stop();
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

  it("refuses a referenceSide that is not a finite number above 0, naming the value", () => {
    const sides: [number, string][] = [
      [0, "0"],
      [-390, "-390"],
      [Number.NaN, "NaN"],
      [Number.POSITIVE_INFINITY, "Infinity"],
      // A game in JavaScript, or one that casts, may pass the side as a string.
      ["390" as unknown as number, '"390"']
    ];

    for (const [referenceSide, got] of sides) {
      expect(() => defineGameApp({ flow: mainFlow, player, session, referenceSide })).toThrow(
        new Error(
          `[game] defineGameApp: referenceSide must be a finite number above 0, got ${got}.\n  Pass the short side of the design frame in reference units: defineGameApp({ referenceSide: 390, ... }).`
        )
      );
    }
    expect(createApp).not.toHaveBeenCalled();
  });

  it("refuses an orientation other than portrait or landscape", () => {
    // The value of page.orientation in config.ts, copied into the definition with a cast.
    const orientation = "any" as unknown as "portrait";

    expect(() => defineGameApp({ flow: mainFlow, player, session, orientation })).toThrow(
      new Error(
        '[game] defineGameApp: orientation must be "portrait" or "landscape", got "any".\n  The layout is designed for one orientation. A native build that turns with the device sets page.orientation: "any" in config.ts.'
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

/**
 * Reads the names the last `createApp` call composed after the engine's screen set.
 *
 * @returns The names after `platform`.
 */
function namesAfterEngine(): string[] {
  const names = (lastOptions().plugins ?? []).map(plugin => plugin.name);

  return names.slice(names.indexOf("platform") + 1);
}

/**
 * The error `defineGameApp` throws for a feature name met twice in one list.
 *
 * @param name - The feature name.
 * @param first - The earlier path in the walk.
 * @param second - The later path.
 * @returns The expected error.
 */
function listedTwice(name: string, first: string, second: string): Error {
  return new Error(
    `[game] defineGameApp: the feature "${name}" is listed twice: ${first} and ${second}.\n  List a sub-feature only in the features of its parent.`
  );
}

describe("feature tree", () => {
  // Three levels: episodes → [kit, ep01 → [ep01Extra]]; each a real defineFeature result.
  const kitFeature = defineFeature("kit", {});
  const ep01ExtraFeature = defineFeature("ep01Extra", {});
  const ep01Feature = defineFeature("ep01", { features: [ep01ExtraFeature] });
  const episodesFeature = defineFeature("episodes", { features: [kitFeature, ep01Feature] });

  it("screen composes a parent before its sub-features, depth first, in declaration order", () => {
    defineGameApp({
      flow: mainFlow,
      player,
      session,
      features: [homeFeature, episodesFeature, rewardFeature]
    }).screen();

    expect(namesAfterEngine()).toEqual([
      "homeScreen",
      "episodes",
      "kit",
      "ep01",
      "ep01Extra",
      "reward"
    ]);
  });

  it("headless composes the logicOnly of a parent and of its sub-features", () => {
    const { app } = defineGameApp({
      flow: mainFlow,
      player,
      session,
      features: [homeFeature, episodesFeature]
    }).headless();
    const plugins = lastOptions().plugins ?? [];

    expect(plugins).toHaveLength(5);
    expect(plugins[0]).toBe(homeFeature.logicOnly);
    expect(plugins[1]).toBe(episodesFeature.logicOnly);
    expect(plugins[2]).toBe(kitFeature.logicOnly);
    expect(plugins[3]).toBe(ep01Feature.logicOnly);
    expect(plugins[4]).toBe(ep01ExtraFeature.logicOnly);
    expect(app.has("ep01Extra")).toBe(true);
  });

  it("headless.features may name a sub-feature alone", () => {
    const { app } = defineGameApp({
      flow: mainFlow,
      player,
      session,
      features: [episodesFeature],
      headless: { features: [ep01Feature] }
    }).headless();

    expect(lastOptions().plugins).toEqual([ep01Feature.logicOnly, ep01ExtraFeature.logicOnly]);
    expect(app.has("episodes")).toBe(false);
  });

  it("refuses a feature listed twice, naming both paths", () => {
    // The same plugin listed by the game and by its parent.
    expect(() =>
      defineGameApp({
        flow: mainFlow,
        player,
        session,
        features: [homeFeature, episodesFeature, ep01Feature]
      })
    ).toThrow(listedTwice("ep01", "features[1].features[1]", "features[2]"));
    // In the headless list, the earlier path first.
    expect(() =>
      defineGameApp({
        flow: mainFlow,
        player,
        session,
        headless: { features: [ep01Feature, episodesFeature] }
      })
    ).toThrow(listedTwice("ep01", "headless.features[0]", "headless.features[1].features[1]"));
    // Two plugins of one name: the name counts, not the object.
    expect(() =>
      defineGameApp({
        flow: mainFlow,
        player,
        session,
        features: [episodesFeature, defineFeature("kit", {})]
      })
    ).toThrow(listedTwice("kit", "features[0].features[0]", "features[1]"));
  });

  it("names the nested path of a sub-feature entry that is not a feature", () => {
    // A cast parent: defineFeature would refuse the plain plugin among its children.
    const notFeature = scorePlugin as unknown as Flow.FeaturePlugin;
    const castParent: Flow.FeaturePlugin = {
      ...episodesFeature,
      features: [kitFeature, notFeature]
    };

    expect(() =>
      defineGameApp({ flow: mainFlow, player, session, features: [castParent] })
    ).toThrow(notAFeature("features[0].features[1]"));
  });

  it("refuses shared with sub-features", () => {
    expect(() =>
      defineGameApp({ flow: mainFlow, player, session, shared: episodesFeature })
    ).toThrow(
      new Error(
        "[game] defineGameApp: shared declares sub-features.\n  The shared layer has none: declare them in a feature of features."
      )
    );
  });
});

describe("the adaptive frame rate", () => {
  const adaptiveGame = defineGameApp({
    flow: mainFlow,
    player,
    session,
    pluginConfigs: { time: { maxFps: 120, adaptive: { floor: 60 } } }
  });

  it("a headless app never adapts", () => {
    const { app } = adaptiveGame.headless();

    expect(lastConfigs().time).toEqual({ maxFps: 120, adaptive: false });
    expect(app.time.rate()).toMatchObject({ fps: 120, mode: "fixed" });
  });

  it("a screen app on a fake clock never adapts, and the page's screen app keeps the game's adaptive", () => {
    const onFake = adaptiveGame.screen();

    expect(onFake.app.time.rate().mode).toBe("fixed");

    const onDevice = adaptiveGame.screen({ clock: systemSource() });

    expect(lastConfigs().time).toEqual({ maxFps: 120, adaptive: { floor: 60 } });
    expect(onDevice.app.time.rate()).toMatchObject({ fps: 120, mode: "auto" });
  });
});
