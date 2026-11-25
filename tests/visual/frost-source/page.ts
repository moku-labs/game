/**
 * @file The page of the Frost-over-a-Source browser leg (`tests/visual/frost-source.visual.ts`, F126 stage 5). Not a
 * test: the leg bundles it with the flags of a dev page and opens it in Chrome on WebGPU, at resolution 1 and 2. A
 * small game draws, on the real engine, the real Pixi and the real GPU: a room of coloured stripes and a pane of milk
 * over it with the set's `Frost`; with `?bare=1` the room is one bare tinted, half-transparent image instead, with no
 * child (a Source on a view that draws itself: wrapped before its first take, review W3). `source(on)` puts `Source()`
 * on the room or takes it off and draws a few game frames;
 * the leg reads the canvas from the browser's own screenshot, once over the Source and once on the backdrop path. The
 * page answers in `globalThis.frostSource`.
 */

import { defineGameApp } from "../../../src/app";
import type { Assets } from "../../../src/index";
import {
  defineGame,
  Frost,
  Layer,
  Parent,
  Shape,
  Source,
  Sprite,
  Transform,
  type
} from "../../../src/index";
import manifestJson from "../../fixtures/mini-game/generated/manifest.json";

/** What the page answers once its scene is up. */
export type FrostSourcePage = {
  backend: string;
  /**
   * Puts `Source()` on the room, or takes it off, and draws ten game frames; answers the Sources, the canvas passes and
   * the kept pictures of the last frame (the pane is one over the Source).
   */
  source(on: boolean): Promise<{ count: number; canvasPasses: number; pictures: number }>;
};

/** One game frame of the paused clock. */
const FRAME_MS = 1000 / 60;

/** The width of the page's portrait game, CSS px and reference units. */
export const SIDE = 480;

/** Its height. */
export const LONG = 640;

/** The pane of milk: its left, top, width and height, CSS px. */
export const PANE = { x: 100, y: 180, width: 280, height: 240 } as const;

/** The owner of the page's views. */
const OWNER = { kind: "plugin", name: "visual" } as const;

/** The texture key every sprite of the page draws. */
const WHITE = "visual.white";

/** The colours of the stripes of the room, left to right. */
const STRIPES = [0xd0_40_40, 0x40_a0_50, 0x40_60_d0, 0xe0_c0_30, 0x90_40_b0, 0x30_b0_b0] as const;

/** The kit of the page's game. */
const kit = defineGame<{
  player: Record<string, never>;
  session: Record<string, never>;
  assets: never;
  scenes: "main";
  strings: Record<string, never>;
  textStyles: never;
  emitters: never;
}>();

const rest = kit.defineNode({
  scene: "main",
  outcomes: { go: type() },
  rest: true,
  checkpoint: true
});
const flow = kit.defineFlow("main", {
  nodes: { rest },
  start: "rest",
  edges: { rest: { go: "rest" } }
});
const main = kit.defineScene("main", { bundle: "ui", layers: { scene: {} }, projections: [] });
const feature = kit.defineFeature("visual", { scenes: [main], filters: [Frost] });

/** The manifest of the page: the mini game's `ui` bundle without its files, so the scene loads nothing. */
const manifest: Assets.Manifest = {
  ...(manifestJson as unknown as Assets.Manifest),
  bundles: { ui: { feature: "ui", tier: "boot", mb: 0, files: [] } }
};

/** The app of the page. */
type App = ReturnType<ReturnType<typeof defineGameApp>["screen"]>["app"];

/**
 * Waits for frames of the page.
 *
 * @param count - How many.
 */
async function frames(count: number): Promise<void> {
  for (let frame = 0; frame < count; frame += 1) {
    await new Promise(resolve => requestAnimationFrame(resolve));
  }
}

/**
 * Runs game frames on the paused clock, each followed by a browser frame, so the canvas shows the last one.
 *
 * @param app - The app.
 * @param count - How many.
 */
async function step(app: App, count: number): Promise<void> {
  for (let frame = 0; frame < count; frame += 1) {
    app.time.step(FRAME_MS);
    await frames(1);
  }
}

/**
 * Spawns the dark room the stripes hang in.
 *
 * @param app - The app.
 * @returns The room.
 */
function stripedRoom(app: App): number {
  return app.world.ecs.spawn(OWNER, [
    Layer({ name: "scene" }),
    Transform({ x: 0, y: 0 }),
    Sprite({ texture: WHITE, width: SIDE, height: LONG, anchor: { x: 0, y: 0 }, tint: 0x20_20_20 })
  ]);
}

/**
 * Spawns a bare room: one green image, half transparent, moved off the corner, under the left half of the pane. Its
 * tint and alpha drawn twice, or its place lost, show as other pixels under the glass.
 *
 * @param app - The app.
 * @returns The room.
 */
function bareRoom(app: App): number {
  return app.world.ecs.spawn(OWNER, [
    Layer({ name: "scene" }),
    Transform({ x: 40, y: 120 }),
    Sprite({
      texture: WHITE,
      width: 220,
      height: 360,
      anchor: { x: 0, y: 0 },
      tint: 0x40_a0_50,
      alpha: 0.6
    })
  ]);
}

/**
 * Starts the game and spawns the room and the pane of milk with `Frost` over it.
 *
 * @returns The page's answer.
 */
async function start(): Promise<FrostSourcePage> {
  const query = new URLSearchParams(location.search);
  const resolution = Number(query.get("resolution") ?? "1");
  const bare = query.get("bare") === "1";
  const mount = document.createElement("div");

  mount.id = "game";
  mount.style.width = `${SIDE}px`;
  mount.style.height = `${LONG}px`;
  document.body.append(mount);

  const { app } = defineGameApp({
    flow,
    safeNode: "rest",
    player: {},
    session: {},
    referenceSide: SIDE,
    referenceLong: LONG,
    features: [feature],
    pluginConfigs: { renderer: { preference: "webgpu", maxResolution: resolution, onDemand: true } }
  }).screen({ manifest, renderer: { mount: "#game" } });

  await app.start();
  app.flow.run().catch(() => undefined);

  for (let frame = 0; frame < 300 && app.flow.state().path !== "rest"; frame += 1) await frames(1);

  await frames(30);
  app.time.pause();

  const pixi = app.renderer.host.pixi();

  if (pixi === undefined) throw new Error("no Pixi module");

  app.renderer.sync.textures.provide(key => (key === WHITE ? pixi.Texture.WHITE : undefined));

  const { ecs } = app.world;
  const stripe = SIDE / STRIPES.length;
  const room = bare ? bareRoom(app) : stripedRoom(app);

  if (!bare) {
    for (const [index, tint] of STRIPES.entries()) {
      ecs.spawn(OWNER, [
        Parent({ entity: room }),
        Transform({ x: index * stripe, y: 0 }),
        Sprite({ texture: WHITE, width: stripe / 2, height: LONG, anchor: { x: 0, y: 0 }, tint })
      ]);
    }
  }

  ecs.spawn(OWNER, [
    Layer({ name: "scene" }),
    Transform({ x: PANE.x, y: PANE.y }),
    Shape({ w: PANE.width, h: PANE.height, fill: 0xff_ff_ff, fillAlpha: 0.25, radius: 20 }),
    Frost({ blur: 12, tint: 0xff_ff_ff })
  ]);

  await step(app, 20);

  return {
    backend: app.renderer.host.kind(),
    source: async on => {
      if (on) ecs.add(room, Source());
      else ecs.remove(room, Source);

      await step(app, 10);

      const stats = app.renderer.stats();

      return {
        count: stats.sources.count,
        canvasPasses: stats.canvasPasses,
        pictures: stats.kept.pictures
      };
    }
  };
}

const target = globalThis as unknown as { frostSource?: FrostSourcePage | { error: string } };

try {
  target.frostSource = await start();
} catch (error) {
  target.frostSource = {
    error: error instanceof Error ? (error.stack ?? error.message) : String(error)
  };
}
