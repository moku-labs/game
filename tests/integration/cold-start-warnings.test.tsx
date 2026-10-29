/**
 * @file Root integration — the warnings of a cold page whose first scene is the board (F117): the editor's reload, a
 * bookmark restore. The first scene of a live page is built aside (spec 31) before any layer exists, so the board's
 * particle emitter in `ui` and its HUD parts are made while the scene has no layers yet. A small game on the fake
 * page, shaped as A Memory Missing's board: a cell in `ui` that emits sparkles, and HUD parts in the HUD layer.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createApp,
  defineEmitter,
  defineGame,
  defineScene,
  Emitter,
  effectsPlugin,
  HudPart,
  Layer,
  projection,
  Shape,
  screen,
  Transform,
  type
} from "../../src";
import type {
  AssetsIo,
  DecodedImage,
  Manifest,
  ManifestFile,
  Texture
} from "../../src/plugins/assets/types";
import {
  createFakeEffectsPixi,
  FakeFxParticleContainer
} from "../../src/plugins/effects/__tests__/fake-effects-pixi";
import type { CompiledMessages } from "../../src/plugins/i18n/types";
import { installFakeDom } from "../../src/plugins/renderer/__tests__/fake-dom";
import {
  type FakeContainer,
  FakeRectangle,
  FakeTexture
} from "../../src/plugins/renderer/__tests__/fake-pixi";
import { fakeClock } from "../../src/testing";

const { defineNode, defineFlow, defineFeature } = defineGame<{
  player: { visits: number };
  session: { visits: number };
  assets: string;
  strings: { "cold.title": Record<string, never> };
}>();

/**
 * One texture file of the board bundle.
 *
 * @param key - The asset key.
 * @returns The manifest entry.
 */
function file(key: string): ManifestFile {
  return { key, path: `features/cold/assets/${key}.png`, width: 32, height: 32, mb: 0.004 };
}

/** The board's bundle holds the sparkle; the ward's a wall, so a cold start on it waits for a file too. */
const manifest: Manifest = {
  version: 2,
  bundles: {
    splash: { feature: "cold", tier: "lazy", mb: 0, files: [] },
    ward: { feature: "cold", tier: "lazy", mb: 0.004, files: [file("cold.wall")] },
    board: { feature: "cold", tier: "lazy", mb: 0.004, files: [file("cold.spark")] }
  }
};

/** The one compiled locale. */
const english: CompiledMessages = { "cold.title": () => [{ kind: "text", text: "cold" }] };

/** The board's sparkles: a stream, so the instance lives on after the commit. */
const sparkles = defineEmitter("cold.sparkles", {
  textures: ["cold.spark"],
  rate: 10,
  lifeMs: [400, 600],
  speed: [20, 40],
  maxParticles: 20
});

/** The board's cell in `ui`: it emits the sparkles. */
const cell = projection({
  name: "cold.cell",
  layer: "ui",
  from: () => [{ id: "cell" }],
  key: (item: { id: string }) => item.id,
  view: () => [
    Transform({ x: 100, y: 100 }),
    Shape({ w: 50, h: 50, fill: 0xff_00_00 }),
    Emitter({ effect: "cold.sparkles" })
  ]
});

/** The HUD parts of the board, as A Memory Missing's level and energy. */
const hud = projection({
  name: "cold.hud",
  layer: "hud",
  from: () => [{ id: "level" }, { id: "energy" }],
  key: (item: { id: string }) => item.id,
  view: (item: { id: string }) => [
    Transform({ x: 10, y: 10 }),
    Shape({ w: 40, h: 20, fill: 0x00_ff_00 }),
    HudPart({ key: item.id })
  ]
});

/** The ward's room. */
const room = projection({
  name: "cold.room",
  layer: "scene",
  from: () => [{ id: "room" }],
  key: (item: { id: string }) => item.id,
  view: () => [Transform(), Shape({ w: 400, h: 400, fill: 0x99_99_99 })]
});

/** The splash's logo, in the one layer the splash declares, as A Memory Missing's loading screen. */
const logo = projection({
  name: "cold.logo",
  layer: "loading",
  from: () => [{ id: "logo" }],
  key: (item: { id: string }) => item.id,
  view: () => [Transform(), Shape({ w: 100, h: 100, fill: 0xff_ff_ff })]
});

const splashScene = defineScene("splash", {
  bundle: "splash",
  layers: { loading: {} },
  projections: [logo]
});
const wardScene = defineScene("ward", {
  bundle: "ward",
  layers: { scene: {}, hud: { above: "overlays" } },
  projections: [room, hud]
});
const boardScene = defineScene("board", {
  bundle: "board",
  layers: { scene: {}, ui: { sort: "order" }, hud: { above: "overlays" } },
  projections: [cell, hud]
});
const splash = defineNode({ rest: true, scene: "splash", outcomes: { ward: type() } });
const ward = defineNode({ rest: true, scene: "ward", outcomes: { board: type() } });
const board = defineNode({ rest: true, scene: "board", outcomes: { back: type() } });

/** The node a cold page starts on. */
type Start = "splash" | "ward" | "board";

/**
 * The game's flow, starting where the page restores to.
 *
 * @param start - The first node: the board for a restore onto it.
 * @returns The flow.
 */
function flowFrom(start: Start) {
  // A flow names only nodes its start reaches: the splash leads in, nothing leads back to it.
  if (start === "splash") {
    return defineFlow("main", {
      nodes: { splash, ward, board },
      start,
      outcomes: {},
      edges: { splash: { ward: "ward" }, ward: { board: "board" }, board: { back: "ward" } }
    });
  }

  return defineFlow("main", {
    nodes: { ward, board },
    start,
    outcomes: {},
    edges: { ward: { board: "board" }, board: { back: "ward" } }
  });
}

/**
 * The in-memory io: every texture is a 32 px frame of one atlas page.
 *
 * @returns The io.
 */
function createIo(): AssetsIo {
  const page = { width: 256, height: 256, destroyed: false };

  return {
    fetch: () =>
      Promise.resolve({
        ok: true,
        status: 200,
        // eslint-disable-next-line unicorn/no-null -- a Response answers a missing header with null.
        headers: { get: () => null },
        json: () => Promise.resolve({}),
        blob: () => Promise.resolve(new Blob(["png"])),
        text: () => Promise.resolve(""),
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(8))
      }),
    decode: () => Promise.resolve({ width: 32, height: 32 } as unknown as DecodedImage),
    createTexture: () =>
      new FakeTexture({
        source: page,
        frame: new FakeRectangle(0, 0, 32, 32)
      }) as unknown as Texture,
    sliceTexture: () => ({ label: "slice" }) as unknown as Texture,
    destroyTexture: () => undefined
  };
}

/** The owner of the views a test spawns itself. */
const PLUGIN = { kind: "plugin", name: "probe" } as const;

/**
 * A fake clock that moves 1 ms with every read: a frame's building budget of 1 ms runs out after a read or two.
 *
 * @returns The clock.
 */
function runningClock() {
  const clock = fakeClock(1000);
  const read = clock.now.bind(clock);

  clock.now = (): number => {
    const moment = read();

    clock.set(moment + 1);

    return moment;
  };

  return clock;
}

const running: Array<{ stop(): Promise<void> }> = [];

afterEach(async () => {
  for (const app of running.splice(0)) await app.stop();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/**
 * Starts a cold page on a first node, every warning kept, and steps until it rests there.
 *
 * @param start - The first node.
 * @param slow - True for a clock that moves 1 ms with every read under a 1 ms budget: a build spans frames.
 * @returns The running app, the frame driver and the reader of the kept warnings.
 */
async function coldStart(start: Start, slow = false) {
  const warned: Array<{ event: string; data: unknown }> = [];

  vi.spyOn(console, "warn").mockImplementation((entry: { event: string; data: unknown }) => {
    warned.push(entry);
  });
  // The HUD check warns in a dev build only.
  vi.stubGlobal("__MOKU_GAME_DEV__", true);
  installFakeDom({ width: 1080, height: 1920 });

  const main = flowFrom(start);
  const feature = defineFeature("cold", {
    flows: [main],
    scenes: [splashScene, wardScene, boardScene],
    projections: [cell, hud, room, logo],
    emitters: [sparkles],
    strings: { en: english }
  });
  const pixi = createFakeEffectsPixi();
  const app = createApp({
    plugins: [...screen, effectsPlugin, feature],
    pluginConfigs: {
      assets: { manifest, io: createIo() },
      flow: { mainFlow: main },
      i18n: { locale: "en", fallback: "en" },
      model: { initialPlayer: { visits: 0 }, initialSession: { visits: 0 }, seed: 1 },
      renderer: { mount: "#game", loadPixi: () => Promise.resolve(pixi.module), warm: 0 },
      ...(slow ? { clock: { source: runningClock() }, scenes: { buildMs: 1 } } : {})
    }
  });

  running.push(app);
  await app.start();
  app.renderer.sync.textures.provide(() => new FakeTexture({}) as never);
  app.flow.run().catch(() => undefined);

  /**
   * Steps frames of 16 ms, the runner given its turn before each.
   *
   * @param count - How many.
   */
  const frames = async (count: number): Promise<void> => {
    for (let frame = 1; frame <= count; frame += 1) {
      for (let turn = 0; turn < 80; turn += 1) await Promise.resolve();
      app.time.step(16);
    }
  };

  for (let frame = 0; frame < 120 && app.scenes.current() !== start; frame += 1) await frames(1);
  await frames(6);
  expect(app.scenes.current()).toBe(start);

  return {
    app,
    frames,
    all: () => warned.map(entry => entry.event),
    warnings: (event: string): unknown[] =>
      warned.filter(entry => entry.event === event).map(entry => entry.data)
  };
}

/** The warnings a cold start used to log, by event (F117); the pass budget is tested in the effects unit tests. */
const COLD = [
  "renderer: entity is not drawn, unknown layer",
  "renderer:hud-part-outside",
  "assets: the node waited for a bundle"
] as const;

describe("a cold page whose first scene is the board (F117)", () => {
  // Bug: the emitter of a cell built aside took `ui` before the board had layers: it was warned and left undrawn.
  it("draws the emitter of a cell in ui once the board's layers exist, with no unknown-layer warning", async () => {
    const cold = await coldStart("board");
    const burst = FakeFxParticleContainer.made.at(-1);

    expect(cold.app.effects.stats().emitters).toBe(1);
    expect(cold.warnings("renderer: entity is not drawn, unknown layer")).toEqual([]);
    expect((burst?.parent as FakeContainer | null | undefined)?.label).toBe("layer:ui");
  });

  // Bug: HUD parts built aside were checked against a HUD layer that did not exist yet, the lazy bundle of the first
  // node was named a bundle the preload missed, though no rest had run a preload yet.
  it.each([
    "board",
    "ward"
  ] as const)("starts cold on the %s without any of the cold-start warnings", async start => {
    const cold = await coldStart(start);

    for (const event of COLD) expect(cold.warnings(event)).toEqual([]);
  });

  // Bug (A Memory Missing, a reload into the ward): the ward's HUD parts were built aside while the splash's layers
  // stood, a list with no HUD layer, and each part was named outside it.
  it("goes from the splash to the ward without naming a HUD part, in a build over several frames", async () => {
    const cold = await coldStart("splash", true);
    let building = 0;

    expect(cold.app.flow.gate.answer({ intent: "ward" })).toBe(true);
    for (let frame = 0; frame < 120 && cold.app.scenes.current() !== "ward"; frame += 1) {
      await cold.frames(1);
      if (cold.app.scenes.current() === "splash") building += 1;
    }

    expect(building).toBeGreaterThan(2);
    await cold.frames(6);

    expect(cold.app.scenes.current()).toBe("ward");
    expect(cold.warnings("renderer:hud-part-outside")).toEqual([]);
  });

  // The warnings stay for what they were made for.
  it("still names a view in a layer the scene does not declare", async () => {
    const cold = await coldStart("board");
    const stray = cold.app.world.ecs.spawn(PLUGIN, [
      Layer({ name: "nowhere" }),
      Transform(),
      Shape({ w: 10, h: 10, fill: 0 })
    ]);

    await cold.frames(2);

    expect(cold.warnings("renderer: entity is not drawn, unknown layer")).toEqual([
      { entity: stray, layer: "nowhere", from: undefined }
    ]);
  });

  it("still names a HUD part outside the HUD layer once the layers exist", async () => {
    const cold = await coldStart("board");
    const stray = cold.app.world.ecs.spawn(PLUGIN, [
      Layer({ name: "scene" }),
      Transform(),
      Shape({ w: 10, h: 10, fill: 0 }),
      HudPart({ key: "shop" })
    ]);

    await cold.frames(2);

    expect(cold.warnings("renderer:hud-part-outside")).toEqual([{ entity: stray, key: "shop" }]);
  });

  it("still names a lazy bundle a node entered after a live rest waits for", async () => {
    const cold = await coldStart("ward");

    expect(cold.app.flow.gate.answer({ intent: "board" })).toBe(true);
    for (let frame = 0; frame < 120 && cold.app.scenes.current() !== "board"; frame += 1) {
      await cold.frames(1);
    }

    expect(cold.warnings("assets: the node waited for a bundle")).toEqual([
      { bundle: "board", path: "board" }
    ]);
  });
});
