import { describe, expect, it } from "vitest";
import { createApp, createPlugin, defineGame, screen, type } from "../../../../index";
import { defineScene } from "../../../scenes/define";
import { assetsPlugin } from "../../index";
import type { Events, Manifest, ManifestFile } from "../../types";
import { createFakeIo } from "../unit/mock-assets";

// ---------------------------------------------------------------------------
// Integration: the real time, lifecycle, model, clock, flow, world, renderer,
// input and assets plugins. There is no document, so `renderer` stays inert:
// `host.ready()` is false and `sync.textures.create` throws. Every texture in
// this file therefore comes out of the fake `io`, which is the point of the seam.
// ---------------------------------------------------------------------------

type Player = { coins: number };
type Session = { visits: number };

const { defineNode, defineFlow, defineFeature } = defineGame<{
  player: Player;
  session: Session;
  assets: string;
  strings: Record<string, unknown>;
}>();

/**
 * Builds one manifest file entry of 128x128 pixels, which is 0.063 MB of texture memory.
 *
 * @param key - Asset key, always prefixed with the feature name.
 * @returns The file entry.
 */
function file(key: string): ManifestFile {
  return {
    key,
    path: `features/board/assets/${key.slice("board.".length)}.png`,
    width: 128,
    height: 128,
    mb: 0.063
  };
}

/** The `.fnt` file the fake io serves for the font of the lazy bundle. */
const FNT = 'info face="body" size=32\npage id=0 file="body_0.png"\n';

/** The font of the lazy bundle: one `.fnt` file with one 128x128 page. */
const font: ManifestFile = {
  key: "board.body",
  path: "features/board/assets/body.fnt",
  kind: "font",
  width: 0,
  height: 0,
  mb: 0.063,
  pages: [{ path: "features/board/assets/body_0.png", width: 128, height: 128, mb: 0.063 }]
};

/** The sound of the lazy bundle. */
const sound: ManifestFile = {
  key: "board.click",
  path: "features/board/assets/click.mp3",
  kind: "audio",
  width: 0,
  height: 0,
  mb: 0.004
};

const manifest: Manifest = {
  version: 1,
  bundles: {
    board: {
      feature: "board",
      tier: "scene",
      mb: 0.126,
      files: [file("board.cell"), file("board.item")]
    },
    "board.chains": {
      feature: "board",
      tier: "feature",
      mb: 0.063,
      files: [file("board.chain")]
    },
    // Lazy: the graph never reaches for it, so only a `load` call brings the font and the sound.
    "board.voices": { feature: "board", tier: "lazy", mb: 0.067, files: [font, sound] },
    boot: { feature: "board", tier: "boot", mb: 0.063, files: [file("board.logo")] },
    shop: { feature: "board", tier: "scene", mb: 0.063, files: [file("board.coin")] },
    ui: { feature: "board", tier: "scene", mb: 0.063, files: [file("board.panel")] }
  }
};

const home = defineNode({ rest: true, scene: "home", outcomes: { play: type() } });
const board = defineNode({
  rest: true,
  scene: "board",
  outcomes: { leave: type(), visit: type() }
});
const shop = defineNode({ rest: true, scene: "shop", outcomes: { back: type() } });

const main = defineFlow("main", {
  nodes: { home, board, shop },
  start: "home",
  edges: {
    home: { play: "board" },
    board: { leave: "home", visit: "shop" },
    shop: { back: "board" }
  }
});

const boardFeature = defineFeature("board", {
  flows: [main],
  // Real scene definitions: `scenes` is part of `screen` and mounts them on every switch.
  scenes: [
    defineScene("home", { bundle: "ui", layers: {}, projections: [] }),
    defineScene("board", { bundle: "board", layers: {}, projections: [] }),
    defineScene("shop", { bundle: "shop", layers: {}, projections: [] })
  ]
});

/** Everything the probe plugin heard from `assets`. */
const heard: {
  loaded: Events["assets:bundle-loaded"][];
  progress: Events["assets:bundle-progress"][];
  unloaded: Events["assets:bundle-unloaded"][];
} = { loaded: [], progress: [], unloaded: [] };

const probePlugin = createPlugin("assetsProbe", {
  depends: [assetsPlugin],
  hooks: () => ({
    "assets:bundle-loaded": (payload: Events["assets:bundle-loaded"]) => {
      heard.loaded.push(payload);
    },
    "assets:bundle-progress": (payload: Events["assets:bundle-progress"]) => {
      heard.progress.push(payload);
    },
    "assets:bundle-unloaded": (payload: Events["assets:bundle-unloaded"]) => {
      heard.unloaded.push(payload);
    }
  })
});

/**
 * Yields the microtask queue to the loop, the way a test waits without a timer.
 *
 * @param times - How many turns to give it.
 */
async function tick(times = 80): Promise<void> {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
}

/**
 * Starts the full screen set over an inline manifest and lets the graph settle on "home".
 *
 * @param io - The I/O seam, or `undefined` for the headless run.
 * @returns The started app.
 */
async function startApp(io?: ReturnType<typeof createFakeIo>) {
  heard.loaded.length = 0;
  heard.progress.length = 0;
  heard.unloaded.length = 0;

  const app = createApp({
    plugins: [...screen, boardFeature, probePlugin],
    pluginConfigs: {
      flow: { mainFlow: main },
      model: { initialPlayer: { coins: 0 }, initialSession: { visits: 0 }, seed: 1 },
      assets: { manifest, preloadDepth: 2, ...(io === undefined ? {} : { io }) }
    }
  });

  await app.start();
  app.flow.run().catch(() => undefined);
  await tick();

  return app;
}

describe("assets plugin integration — headless", () => {
  it("reads the manifest and answers without loading anything", async () => {
    const app = await startApp();

    expect(app.renderer.host.ready()).toBe(false);
    expect(app.assets.isLoaded("board")).toBe(true);
    expect(app.assets.isLoaded("bord")).toBe(false);

    await expect(app.assets.load("board")).resolves.toBeUndefined();

    expect(app.assets.texture("board.cell")).toBeUndefined();
    expect(app.assets.usage()).toEqual({ textureMb: 0, budgetMb: 192, bundles: [] });
    expect(heard.loaded).toEqual([]);

    await app.stop();
  });

  it("plays the graph with no fetch, no event and no preload queue", async () => {
    const app = await startApp();

    expect(app.flow.state().path).toBe("home");
    expect(app.flow.gate.answer({ intent: "play" })).toBe(true);
    await tick();

    expect(app.flow.state().path).toBe("board");
    expect(app.assets.usage().bundles).toEqual([]);
    expect(heard.loaded).toEqual([]);
    expect(heard.unloaded).toEqual([]);

    await app.stop();
  });
});

describe("assets plugin integration — with an io seam", () => {
  it("makes every texture through the io, never through the inert renderer", async () => {
    const io = createFakeIo();
    const app = await startApp(io);

    // The renderer draws nothing, so its own texture factory refuses. The textures that exist
    // can only have come from the configured `io`.
    expect(app.renderer.host.ready()).toBe(false);
    expect(() => app.renderer.sync.textures.create({} as ImageBitmap)).toThrow();
    expect(io.created.length).toBeGreaterThan(0);
    expect(io.created).toContain(app.assets.texture("board.logo"));

    await app.stop();
  });

  it("awaits the boot tier at start and the node's bundles when it enters one", async () => {
    const io = createFakeIo();
    const app = await startApp(io);

    expect(io.fetched[0]).toBe("/features/board/assets/logo.png");
    expect(heard.loaded[0]).toEqual({ bundle: "boot", tier: "boot", mb: 0.063, reason: "boot" });

    // "home" shows the scene bundle "ui", and the feature owning the flow brings its feature tier.
    expect(app.assets.isLoaded("ui")).toBe(true);
    expect(app.assets.isLoaded("board.chains")).toBe(true);
    expect(app.assets.isLoaded("board")).toBe(false);
    expect(heard.loaded.map(entry => entry.reason)).toEqual(["boot", "enter", "enter"]);

    await app.stop();
  });

  it("preloads the neighbourhood at a rest node, so the next node does not wait", async () => {
    const io = createFakeIo();
    const app = await startApp(io);

    expect(app.flow.gate.answer({ intent: "play" })).toBe(true);
    await tick();

    // The edge commits and `flow:rest` fires before the next node is entered, so the walk from
    // "home" already queued "board" (one edge away) and "shop" (two). Entering "board" joins the
    // running load instead of starting its own, which is why the reason stays "preload".
    expect(app.flow.state().path).toBe("board");
    expect(heard.loaded.find(entry => entry.bundle === "board")).toEqual({
      bundle: "board",
      tier: "scene",
      mb: 0.126,
      reason: "preload"
    });
    expect(heard.loaded.find(entry => entry.bundle === "shop")).toEqual({
      bundle: "shop",
      tier: "scene",
      mb: 0.063,
      reason: "preload"
    });
    expect(app.assets.usage().bundles.map(entry => entry.name)).toEqual([
      "board",
      "board.chains",
      "boot",
      "shop",
      "ui"
    ]);
    expect(app.assets.usage().textureMb).toBeCloseTo(0.378, 3);

    await app.stop();
  });

  it("answers a texture by key and reports an unload of a bundle the graph left", async () => {
    const io = createFakeIo();
    const app = await startApp(io);

    expect(app.flow.gate.answer({ intent: "play" })).toBe(true);
    await tick();

    const texture = app.assets.texture("board.cell");

    expect(texture).toBeDefined();
    expect(io.created).toContain(texture);
    expect(app.assets.texture("board.cell")).toBe(texture);
    expect(app.assets.texture("board.nothing")).toBeUndefined();

    app.assets.unload("ui");
    // The kernel awaits every hook in order, so a listener after `text` runs a microtask later.
    await tick();

    expect(app.assets.isLoaded("ui")).toBe(false);
    expect(heard.unloaded).toEqual([
      { bundle: "ui", tier: "scene", mb: 0.063, reason: "request", keys: ["board.panel"] }
    ]);

    // "board" is pinned by the node the graph stands on, and "boot" is a permanent tier.
    app.assets.unload("board");
    app.assets.unload("boot");
    await tick();

    expect(app.assets.isLoaded("board")).toBe(true);
    expect(app.assets.isLoaded("boot")).toBe(true);
    expect(heard.unloaded).toHaveLength(1);

    await app.stop();
  });

  it("hands a font and the audio bytes to the plugins above, and takes them back", async () => {
    const io = createFakeIo();

    io.texts.set("/features/board/assets/body.fnt", FNT);

    const app = await startApp(io);

    await app.assets.load("board.voices");

    const loaded = app.assets.font("board.body");

    expect(loaded?.fnt).toBe(FNT);
    expect(io.created).toContain(loaded?.texture);
    expect(app.assets.audio("board.click")).toBeInstanceOf(ArrayBuffer);
    // A page is part of its font: it is no texture key of its own.
    expect(app.assets.texture("board.body")).toBeUndefined();

    app.assets.unload("board.voices");
    await tick();

    expect(app.assets.font("board.body")).toBeUndefined();
    expect(app.assets.audio("board.click")).toBeUndefined();
    expect(heard.unloaded.at(-1)).toEqual({
      bundle: "board.voices",
      tier: "lazy",
      mb: 0.067,
      reason: "request",
      keys: ["board.body", "board.click"]
    });

    await app.stop();
  });

  it("tells a plugin above how far a load got, file by file", async () => {
    const io = createFakeIo();

    io.texts.set("/features/board/assets/body.fnt", FNT);

    const app = await startApp(io);

    heard.progress.length = 0;
    await app.assets.load("board.voices");
    await tick();

    // A font with its page and a sound: two files, so two events, the last one at the total.
    expect(heard.progress).toEqual([
      { bundle: "board.voices", loaded: 1, total: 2 },
      { bundle: "board.voices", loaded: 2, total: 2 }
    ]);
    expect(heard.loaded.at(-1)?.bundle).toBe("board.voices");

    await app.stop();
  });

  it("destroys every texture on stop", async () => {
    const io = createFakeIo();
    const app = await startApp(io);

    expect(io.created.length).toBeGreaterThan(0);
    expect(io.destroyed).toEqual([]);

    await app.stop();

    expect(io.destroyed).toHaveLength(io.created.length);
    expect(app.assets.usage().bundles).toEqual([]);
  });
});
