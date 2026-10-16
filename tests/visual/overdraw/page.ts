/**
 * @file The page of the overdraw browser leg (`tests/visual/overdraw.visual.ts`, U6). Not a test: the leg bundles it
 * with the flags of a dev page and opens it in Chrome on WebGPU and on WebGL (`?renderer=webgl`). A small game draws
 * three white sprites stacked from the left edge, 480, 320 and 160 CSS px wide and the whole 640 high, each with its own
 * tint, on the real engine, the real Pixi and the real GPU. `overdraw(on)` switches the heat map and draws a few game
 * frames; the leg reads the canvas from the browser's own screenshot, since the heat map exists on the canvas alone
 * (`capture()` renders the game). The page answers in `globalThis.overdraw`.
 */

import { defineGameApp } from "../../../src/app";
import type { Assets } from "../../../src/index";
import { defineGame, Layer, Sprite, Transform, type } from "../../../src/index";
import manifestJson from "../../fixtures/mini-game/generated/manifest.json";

/** What the page answers once its scene is up. */
export type OverdrawPage = {
  backend: string;
  /** Switches the heat map and draws five game frames; resolves after the last. */
  overdraw(on: boolean): Promise<void>;
};

/** One game frame of the paused clock: the frame of the visual runner. */
const FRAME_MS = 1000 / 60;

/** The width of the page's portrait game, CSS px and reference units. */
export const SIDE = 480;

/** Its height: 4:3, the squarest frame the renderer draws without bars. */
export const LONG = 640;

/** The owner of every view the page spawns. */
const OWNER = { kind: "plugin", name: "visual" } as const;

/** The texture key every sprite of the page draws. */
const WHITE = "visual.white";

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
const main = kit.defineScene("main", {
  bundle: "ui",
  layers: { main: { sort: "order" } },
  projections: []
});
const feature = kit.defineFeature("visual", { scenes: [main] });

/** The manifest of the page: the mini game's `ui` bundle without its files, so the scene loads nothing. */
const manifest: Assets.Manifest = {
  ...(manifestJson as unknown as Assets.Manifest),
  bundles: { ui: { feature: "ui", tier: "boot", mb: 0, files: [] } }
};

/** The app of the page. */
type App = ReturnType<ReturnType<typeof defineGameApp>["screen"]>["app"];

/**
 * Waits for frames of the page, while the clock still runs on them.
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
 * Starts the game and spawns the three stacked sprites.
 *
 * @returns The page's answer.
 */
async function start(): Promise<OverdrawPage> {
  const preference =
    new URLSearchParams(location.search).get("renderer") === "webgl" ? "webgl" : "webgpu";
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
    pluginConfigs: { renderer: { preference, maxResolution: 1, onDemand: true } }
  }).screen({ manifest, renderer: { mount: "#game" } });

  await app.start();
  app.flow.run().catch(() => undefined);

  for (let frame = 0; frame < 300 && app.flow.state().path !== "rest"; frame += 1) await frames(1);

  await frames(30);
  app.time.pause();

  const pixi = app.renderer.host.pixi();

  if (pixi === undefined) throw new Error("no Pixi module");

  app.renderer.sync.textures.provide(key => (key === WHITE ? pixi.Texture.WHITE : undefined));

  const tints = [0xff_40_40, 0x40_ff_40, 0x40_40_ff];

  for (const [index, width] of [SIDE, (SIDE * 2) / 3, SIDE / 3].entries()) {
    app.world.ecs.spawn(OWNER, [
      Layer({ name: "main" }),
      Transform({ x: 0, y: 0 }),
      Sprite({
        texture: WHITE,
        width,
        height: LONG,
        anchor: { x: 0, y: 0 },
        tint: tints[index] ?? 0
      })
    ]);
  }

  await step(app, 5);

  return {
    backend: app.renderer.host.kind(),
    overdraw: async on => {
      app.renderer.sync.debug.overdraw(on);
      await step(app, 5);
    }
  };
}

const target = globalThis as unknown as { overdraw?: OverdrawPage | { error: string } };

try {
  target.overdraw = await start();
} catch (error) {
  target.overdraw = {
    error: error instanceof Error ? (error.stack ?? error.message) : String(error)
  };
}
