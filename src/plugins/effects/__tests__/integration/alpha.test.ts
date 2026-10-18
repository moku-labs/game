import { describe, expect, it } from "vitest";
import { createApp, defineGame, type } from "../../../../index";
import { animPlugin } from "../../../anim";
import { assetsPlugin } from "../../../assets";
import type { AssetsIo, DecodedImage, Manifest, Texture } from "../../../assets/types";
import { rendererPlugin } from "../../../renderer";
import { installFakeDom } from "../../../renderer/__tests__/fake-dom";
import {
  type FakeContainer,
  FakeRectangle,
  FakeTexture
} from "../../../renderer/__tests__/fake-pixi";
import { Shape, Transform } from "../../../renderer/components";
import { worldPlugin } from "../../../world";
import { Alpha } from "../../filters/builtins";
import { effectsPlugin } from "../../index";
import { createFakeEffectsPixi, type FakeEffectsPixi } from "../fake-effects-pixi";

// ---------------------------------------------------------------------------
// Integration: the core Alpha on a running app drawn on demand — the real time,
// flow, world, renderer (on the fake Pixi and the fake DOM), assets, anim and
// effects. At 1 it hangs no filter and costs no pass; the switch at 1 is a
// change that draws its frame.
// ---------------------------------------------------------------------------

type Empty = { n: number };

const kit = defineGame<{
  player: Empty;
  session: Empty;
  assets: string;
  scenes: "main";
  strings: Record<string, unknown>;
}>();

/** One frame of 16 ms. */
const FRAME_MS = 16;

/** The bundle of the fixture's scene holds no file. */
const MANIFEST: Manifest = {
  version: 1,
  bundles: { fixture: { feature: "fixture", tier: "boot", mb: 0, files: [] } }
};

/**
 * The in-memory io: nothing is ever fetched for the empty bundle.
 *
 * @returns The io.
 */
function createIo(): AssetsIo {
  return {
    fetch: () => Promise.reject(new Error("nothing to fetch")),
    decode: () => Promise.resolve({ width: 1, height: 1 } as unknown as DecodedImage),
    createTexture: () =>
      new FakeTexture({
        source: { width: 1, height: 1, destroyed: false },
        frame: new FakeRectangle(0, 0, 1, 1)
      }) as unknown as Texture,
    sliceTexture: () => ({ label: "slice" }) as unknown as Texture,
    destroyTexture: () => undefined
  };
}

/** Yields the microtask queue to the flow loop. */
async function tick(times = 60): Promise<void> {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
}

/**
 * Starts an app drawn on demand with one veil: a full-screen rectangle under an `Alpha` at 1.
 *
 * @returns The app and the fake Pixi.
 */
async function startVeil() {
  installFakeDom({ width: 1080, height: 1920 });

  const pixi = createFakeEffectsPixi();
  const veil = kit.projection({
    name: "fixture.veil",
    layer: "main",
    from: () => ({}),
    view: () => [
      Transform({ x: 0, y: 0 }),
      Shape({ kind: "rect", w: 390, h: 844, fill: 0x9f_b7_b4 }),
      Alpha()
    ]
  });
  const home = kit.defineNode({ outcomes: { quit: type() }, rest: true });
  const main = kit.defineFlow("main", {
    nodes: { home },
    start: "home",
    edges: { home: { quit: "home" } }
  });
  const feature = kit.defineFeature("fixture", { flows: [main], projections: [veil] });
  const app = createApp({
    plugins: [worldPlugin, rendererPlugin, assetsPlugin, animPlugin, effectsPlugin, feature],
    pluginConfigs: {
      log: { mode: "test" },
      flow: { mainFlow: main },
      model: { initialPlayer: { n: 0 }, initialSession: { n: 0 }, seed: 1 },
      // The warm-up of spec 27 would draw probes and ask for frames: the frames counted here are the veil's own.
      renderer: {
        mount: "#game",
        onDemand: true,
        loadPixi: () => Promise.resolve(pixi.module),
        warm: 0
      },
      assets: { manifest: MANIFEST, io: createIo() }
    }
  });

  await app.start();
  app.flow.run().catch(() => undefined);
  await tick();
  app.world.projection.setLayers([{ name: "main", sort: "order" }]);
  app.world.projection.mount(["fixture.veil"], { kind: "plugin", name: "test" });

  return { app, pixi };
}

/**
 * Runs frames of 16 ms, letting promises settle between them.
 *
 * @param app - The app.
 * @param app.time - Its time.
 * @param app.time.step - Steps one frame.
 * @param count - How many.
 */
async function frames(
  app: { time: { step(deltaMs: number): void } },
  count: number
): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    app.time.step(FRAME_MS);
    await tick(8);
  }
}

/**
 * The renders the fake application drew.
 *
 * @param pixi - The fake Pixi.
 * @returns The count.
 */
function rendersOf(pixi: FakeEffectsPixi): number {
  return (pixi.last().renderer as unknown as { renders: number }).renders;
}

describe("the core Alpha on a running app", () => {
  // Bug: an Alpha at 1 still renders its subtree into a texture and back in every frame; or its switch at 1 is a
  // write render on demand never draws, and the screen keeps the old fade; or the pass count still counts it.
  it("at 1 hangs no filter and costs no pass; leaving 1 hangs it and draws the frame; back at 1 it comes off and draws", async () => {
    const { app, pixi } = await startVeil();

    await frames(app, 6);

    const [entity = 0] = [...app.world.ecs.query(Alpha)].map(([found]) => found);
    const object = app.renderer.sync.displayOf(entity) as FakeContainer;
    const rest = rendersOf(pixi);

    expect(object.filters ?? []).toEqual([]);
    expect(app.effects.stats().renderPasses).toBe(1);

    await frames(app, 4);

    expect(rendersOf(pixi)).toBe(rest);

    app.world.ecs.set(entity, Alpha, { alpha: 0.5 });
    await frames(app, 1);

    expect(rendersOf(pixi)).toBe(rest + 1);
    expect(object.filters).toHaveLength(1);
    // The frame, the veil's content, the alpha's pass.
    expect(app.effects.stats().renderPasses).toBe(3);

    app.world.ecs.set(entity, Alpha, { alpha: 1 });
    await frames(app, 1);

    expect(rendersOf(pixi)).toBe(rest + 2);
    expect(object.filters ?? []).toEqual([]);
    expect(app.effects.stats().renderPasses).toBe(1);

    // A resolution at 1 keeps the pass: the veil is drawn at fewer pixels through it.
    app.world.ecs.set(entity, Alpha, { resolution: 0.5 });
    await frames(app, 1);

    expect(rendersOf(pixi)).toBe(rest + 3);
    expect(object.filters).toHaveLength(1);
    expect(app.effects.stats().renderPasses).toBe(3);

    await app.stop();
  });
});
