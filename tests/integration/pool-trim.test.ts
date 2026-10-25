/**
 * @file Root integration — the pool trim (spec 25 C14, T2.1): the renderer gives back the idle render targets Pixi's
 * global `TexturePool` keeps, strictly between frames: after a second of a still screen, a second after a scene
 * switch, and when the game goes to the background. Cross-plugin: renderer, scenes, effects, time, lifecycle, flow.
 * The renderer runs for real over Pixi's own display objects and Pixi's real pool (`drawn-helpers.ts`); the stand-in
 * GPU does what Pixi's filter system does on a drawn frame: one pooled texture per filtered container, the size of
 * its bounds, taken for the frame and returned at its end, and listed as a GPU texture until it is destroyed. The
 * tree oracle checks every frame, so a trim that changed the picture or cost a frame fails the test.
 */
import type { Assets } from "@moku-labs/game";
import { defineFilter, defineGame, Shape, Transform, type } from "@moku-labs/game";
import { defineGameApp } from "@moku-labs/game/app";
import { fakeClock } from "@moku-labs/game/testing";
import * as pixi from "pixi.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type DrawnPage, openPage, type Watched, watch } from "./drawn-helpers";

/** The bundle of both scenes holds no file. */
const MANIFEST: Assets.Manifest = {
  version: 2,
  bundles: { poolTrim: { feature: "poolTrim", tier: "core", mb: 0, files: [] } }
};

const { defineNode, defineFlow, defineFeature, defineScene, projection } = defineGame<{
  player: { n: number };
  session: Record<string, never>;
  assets: string;
  scenes: "board" | "shop";
  strings: Record<string, never>;
}>();

/** A frosted glass: one filter pass, so one pooled target per filtered view and frame. */
const Frost = defineFilter("poolTrim.frost", {
  wgsl: "@fragment fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> { return textureSample(uTexture, uSampler, uv) * fu.amount; }",
  glsl: "void main() { finalColor = texture(uTexture, vTextureCoord) * amount; }",
  uniforms: { amount: 1 }
});

/** The board's full-screen veil (390 x 844: a 512 x 1024 target, 2 MiB) and its card (300 x 300: 1 MiB). */
const boardViews = projection({
  name: "poolTrim.board",
  layer: "main",
  from: () => [
    { id: "veil", x: 0, y: 0, w: 390, h: 844 },
    { id: "card", x: 45, y: 200, w: 300, h: 300 }
  ],
  key: view => view.id,
  view: view => [
    Transform({ x: view.x, y: view.y }),
    Shape({ kind: "rect", w: view.w, h: view.h, fill: 0x9f_b7_b4 }),
    Frost({ amount: 1 })
  ]
});

/** The shop's shelf (200 x 200: a 256 x 256 target). */
const shopShelf = projection({
  name: "poolTrim.shelf",
  layer: "main",
  from: () => ({ id: "shelf" }),
  view: () => [
    Transform({ x: 95, y: 300 }),
    Shape({ kind: "rect", w: 200, h: 200, fill: 0xff_9b_83 }),
    Frost({ amount: 0.5 })
  ]
});

const board = defineNode({
  scene: "board",
  outcomes: { open: type() },
  rest: true,
  checkpoint: true
});
const shop = defineNode({ scene: "shop", outcomes: { close: type() }, rest: true });
const mainFlow = defineFlow("main", {
  nodes: { board, shop },
  start: "board",
  edges: { board: { open: "shop" }, shop: { close: "board" } }
});

const boardScene = defineScene("board", {
  bundle: "poolTrim",
  layers: { main: { sort: "order" } },
  projections: [boardViews]
});
const shopScene = defineScene("shop", {
  bundle: "poolTrim",
  layers: { main: { sort: "order" } },
  projections: [shopShelf]
});
const poolTrimFeature = defineFeature("poolTrim", {
  scenes: [boardScene, shopScene],
  projections: [boardViews, shopShelf],
  filters: [Frost]
});

/** A running fixture: its app, the frame driver with the oracle, and every target the stand-in GPU took. */
type Running = Watched & {
  app: ReturnType<ReturnType<typeof defineGameApp>["screen"]>["app"];
  /** The source of every pooled texture a drawn frame took, oldest first: a destroyed texture lets go of its own. */
  taken: pixi.TextureSource[];
  /** The MiB of render targets the renderer reports. */
  targetsMb(): number;
};

const running: Running[] = [];

afterEach(async () => {
  for (const fixture of running.splice(0)) {
    fixture.oracle.expectNoMissedFrame();
    await fixture.app.stop();
  }

  vi.unstubAllGlobals();
});

/**
 * Lists a pooled texture's source as a GPU texture until it unloads, as Pixi's texture system lists every source it
 * drew with.
 *
 * @param managed - The stand-in's `renderer.texture.managedTextures`.
 * @param source - The source of a texture the pool handed out.
 */
function listOnGpu(managed: unknown[], source: pixi.TextureSource): void {
  if (managed.includes(source)) return;

  managed.push(source);
  source.once("unload", () => {
    if (managed.includes(source)) managed.splice(managed.indexOf(source), 1);
  });
}

/**
 * Makes the stand-in GPU take what Pixi's filter system takes on a drawn frame: a pooled texture of each shown
 * filtered container's bounds, all held to the end of the frame, then returned.
 *
 * @param page - The page the app draws on.
 * @returns The source of every texture taken, oldest first.
 */
function filterPasses(page: DrawnPage): pixi.TextureSource[] {
  const app = page.stage.last();
  const managed = app.renderer.texture.managedTextures;
  const taken: pixi.TextureSource[] = [];

  /**
   * Takes a target for every shown filtered container under a node.
   *
   * @param node - The node.
   * @param held - The targets of this frame.
   */
  const visit = (node: pixi.Container, held: pixi.Texture[]): void => {
    if (!node.visible || !node.renderable) return;

    const filters = node.filters as readonly pixi.Filter[] | null | undefined;

    if (filters?.some(filter => filter.enabled) === true) {
      const bounds = node.getBounds();
      const texture = pixi.TexturePool.getOptimalTexture({
        width: Math.max(1, bounds.width),
        height: Math.max(1, bounds.height),
        resolution: app.renderer.resolution
      });

      held.push(texture);
      taken.push(texture.source);
      listOnGpu(managed, texture.source);
    }

    for (const child of node.children) visit(child, held);
  };

  app.renderer.watchers.push(call => {
    if (call.target !== undefined) return;

    const held: pixi.Texture[] = [];

    visit(call.container, held);
    for (const texture of held) pixi.TexturePool.returnTexture(texture);
  });

  return taken;
}

/**
 * Starts the fixture on the board on a fake clock and draws its first frames.
 *
 * @param options - What differs from the game as it ships.
 * @param options.onDemand - The renderer's switch.
 * @param options.poolTrim - The trim; `{ restMs: 1000, aboveMb: 1 }` when left out: the board holds 3 MiB.
 * @returns The running fixture.
 */
async function open(options: {
  onDemand: boolean;
  poolTrim?: false | { restMs: number; aboveMb: number };
}): Promise<Running> {
  const page = openPage();
  const clock = fakeClock(1000);
  const { app } = defineGameApp({
    flow: mainFlow,
    safeNode: "board",
    player: { n: 0 },
    session: {},
    // A 390 x 844 page at scale 1: a view's reference size is its size in pixels.
    referenceSide: 390,
    referenceLong: 844,
    features: [poolTrimFeature],
    pluginConfigs: {
      log: { mode: "test" },
      flow: { holdMs: 0 },
      renderer: {
        ...page.renderer,
        onDemand: options.onDemand,
        // Every filtered view is drawn live, so every drawn frame takes its targets from the pool.
        keptMb: 0,
        poolTrim: options.poolTrim ?? { restMs: 1000, aboveMb: 1 }
      }
    }
  }).screen({ manifest: MANIFEST, clock });

  await app.start();

  const taken = filterPasses(page);

  app.flow.run().catch(() => undefined);

  const fixture: Running = {
    ...watch(app, page, clock),
    app,
    taken,
    targetsMb: () => app.renderer.stats().textureMbSplit.targets
  };

  running.push(fixture);
  // The first frames mount the scene, build the filters and draw the board.
  await fixture.frames(12);

  return fixture;
}

/**
 * Waits until the flow rests at a node with its gate open. A turn that does not open it steps a
 * frame, checked by the oracle: a live switch with a drawing renderer builds its scene aside over
 * frames and opens the gate after the commit (spec 31), so the frames after it count from the
 * commit.
 *
 * @param fixture - The running fixture.
 * @param path - The path of the rest node.
 */
async function arrive(fixture: Running, path: string): Promise<void> {
  const { flow } = fixture.app;
  const rests = (): boolean => flow.state().path === path && flow.gate.state().open;

  for (let attempt = 0; attempt < 400; attempt += 1) {
    if (rests()) return;
    await new Promise(resolve => setTimeout(resolve, 0));
    if (!rests()) await fixture.frames(1);
  }

  throw new Error(`The flow did not rest at "${path}".`);
}

/**
 * Tells whether every source of a list was destroyed.
 *
 * @param sources - The sources of pooled textures.
 * @returns True when each is destroyed.
 */
function allDestroyed(sources: readonly pixi.TextureSource[]): boolean {
  return sources.length > 0 && sources.every(source => source.destroyed);
}

/**
 * Lets the hooks of an event run: the kernel hands an event to its hooks one after the other.
 */
async function settle(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0));
}

describe("the pool trim between frames", () => {
  it("a still screen gives back its idle targets after a second, and the next drawn frame takes new ones", async () => {
    const fixture = await open({ onDemand: true });
    const boardTargets = [...fixture.taken];

    expect(fixture.targetsMb()).toBe(3);
    expect(await fixture.frames(40)).toBe(0);
    expect(allDestroyed(boardTargets)).toBe(false);

    // A trim draws no frame and changes no pixel: the oracle reads every one of these frames.
    expect(await fixture.frames(40)).toBe(0);
    expect(allDestroyed(boardTargets)).toBe(true);
    expect(fixture.targetsMb()).toBe(0);

    fixture.app.time.wake();

    expect(await fixture.frames(1)).toBe(1);

    const fresh = fixture.taken.slice(boardTargets.length);

    expect(fresh.length).toBeGreaterThan(0);
    expect(fresh.some(source => source.destroyed)).toBe(false);
    expect(fixture.targetsMb()).toBe(3);
  });

  it("a scene switch gives back the targets of the left scene a second later, while every frame is drawn", async () => {
    const fixture = await open({ onDemand: false });

    // Past the first scene's own second: its trim is behind us, the board took its targets again since.
    await fixture.frames(70);

    // The veil's and the card's targets of the board's last frame: idle in the pool once the shop is up.
    const boardTargets = fixture.taken.slice(-2);

    fixture.app.flow.gate.answer({ intent: "open" });
    await arrive(fixture, "shop");
    await fixture.frames(1);

    expect(await fixture.frames(58)).toBe(58);
    expect(boardTargets.some(source => source.destroyed)).toBe(false);

    expect(await fixture.frames(8)).toBe(8);
    expect(allDestroyed(boardTargets)).toBe(true);
    // The shelf is drawn every frame: its target was taken again after the trim.
    expect(fixture.targetsMb()).toBe(0.25);
  });

  it("the game going to the background gives back the targets at once, and the screen draws them again on its return", async () => {
    const fixture = await open({ onDemand: true });
    const boardTargets = [...fixture.taken];

    fixture.app.lifecycle.push("background");
    await settle();

    expect(allDestroyed(boardTargets)).toBe(true);
    expect(fixture.targetsMb()).toBe(0);

    fixture.app.lifecycle.pop("background");
    fixture.app.time.wake();

    expect(await fixture.frames(1)).toBe(1);
    expect(fixture.targetsMb()).toBe(3);
  });

  it("with poolTrim false the targets stay through a rest and a pause", async () => {
    const fixture = await open({ onDemand: true, poolTrim: false });

    expect(await fixture.frames(90)).toBe(0);
    fixture.app.lifecycle.push("background");
    await settle();

    expect(fixture.taken.some(source => source.destroyed)).toBe(false);
    expect(fixture.targetsMb()).toBe(3);

    fixture.app.lifecycle.pop("background");
  });
});
