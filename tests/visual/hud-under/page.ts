/**
 * @file The page of the HUD-under-the-veil browser leg (`tests/visual/hud-under.visual.ts`, F147). Not a test: the leg
 * bundles it with the flags of a dev page and opens it in Chrome on WebGPU and on WebGL (`?renderer=webgl`). A small
 * game draws, on the real engine, the real Pixi and the real GPU: the scene layer filled with one colour, an overlay
 * root in the `ui` layer (`Overlay({ dim: 0.82, dimColor: 0x1e161a, hud: "under" })`, landed) that is a bright panel
 * away from the HUD, and an opaque white square in the HUD layer. `hud(mode)` writes the overlay's `hud` and draws a few
 * game frames; the leg reads the canvas from the browser's own screenshot. The page answers in `globalThis.hudUnder`.
 */

import { defineGameApp } from "../../../src/app";
import type { Assets } from "../../../src/index";
import {
  defineGame,
  Layer,
  Order,
  Overlay,
  type OverlayValue,
  Sprite,
  Transform,
  type
} from "../../../src/index";
import { OverlayLevel } from "../../../src/plugins/renderer/components";
import manifestJson from "../../fixtures/mini-game/generated/manifest.json";

/** What the page answers once its scene is up. */
export type HudUnderPage = {
  backend: string;
  /** Writes the overlay's `hud` and draws five game frames; resolves after the last. */
  hud(mode: OverlayValue["hud"]): Promise<void>;
};

/** One game frame of the paused clock: the frame of the visual runner. */
const FRAME_MS = 1000 / 60;

/** The width of the page's portrait game, CSS px and reference units. */
export const SIDE = 480;

/** Its height: 4:3, the squarest frame the renderer draws without bars. */
export const LONG = 640;

/** How dark the veil is. */
export const DIM = 0.82;

/** The colour of the veil, 0xRRGGBB. */
export const DIM_COLOR = 0x1e_16_1a;

/** The colour the scene layer is filled with. */
export const SCENE_COLOR = 0x30_60_c0;

/** The colour of the overlay's panel. */
export const PANEL_COLOR = 0xff_d0_40;

/** The HUD square: its left, top and side, CSS px. */
export const SQUARE = { x: 40, y: 40, side: 80 } as const;

/** The overlay's panel: its left, top, width and height, CSS px, away from the HUD square. */
export const PANEL = { x: 140, y: 400, width: 200, height: 120 } as const;

/** The owner of the scene and HUD views. */
const OWNER = { kind: "plugin", name: "visual" } as const;

/** The owner `ui` gives its elements: the only overlays the renderer honours. */
const UI_OWNER = { kind: "plugin", name: "ui" } as const;

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
  layers: { scene: {}, ui: { sort: "order" }, hud: { above: "overlays" } },
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
 * The components of one white sprite with its top left corner at a point.
 *
 * @param layer - The layer it draws in.
 * @param box - Where and how big.
 * @param box.x - Left, CSS px.
 * @param box.y - Top, CSS px.
 * @param box.width - Width, CSS px.
 * @param box.height - Height, CSS px.
 * @param tint - Its colour.
 * @returns The components.
 */
function rect(
  layer: string,
  box: { x: number; y: number; width: number; height: number },
  tint: number
) {
  return [
    Layer({ name: layer }),
    Transform({ x: box.x, y: box.y }),
    Sprite({
      texture: WHITE,
      width: box.width,
      height: box.height,
      anchor: { x: 0, y: 0 },
      tint
    })
  ];
}

/**
 * Starts the game and spawns the scene fill, the HUD square and the overlay's panel, the overlay landed.
 *
 * @returns The page's answer.
 */
async function start(): Promise<HudUnderPage> {
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

  const { ecs } = app.world;

  ecs.spawn(OWNER, rect("scene", { x: 0, y: 0, width: SIDE, height: LONG }, SCENE_COLOR));
  ecs.spawn(
    OWNER,
    rect("hud", { x: SQUARE.x, y: SQUARE.y, width: SQUARE.side, height: SQUARE.side }, 0xff_ff_ff)
  );

  const overlay = ecs.spawn(UI_OWNER, [
    ...rect("ui", PANEL, PANEL_COLOR),
    Order({ value: 1 }),
    Overlay({ dim: DIM, dimColor: DIM_COLOR, hud: "under" }),
    OverlayLevel({ level: 1, landed: true })
  ]);

  await step(app, 10);

  return {
    backend: app.renderer.host.kind(),
    hud: async mode => {
      ecs.set(overlay, Overlay, { hud: mode });
      await step(app, 5);
    }
  };
}

const target = globalThis as unknown as { hudUnder?: HudUnderPage | { error: string } };

try {
  target.hudUnder = await start();
} catch (error) {
  target.hudUnder = {
    error: error instanceof Error ? (error.stack ?? error.message) : String(error)
  };
}
