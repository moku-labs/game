import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, defineGame, type } from "../../../../index";
import { animPlugin } from "../../../anim";
import { assetsPlugin } from "../../../assets";
import type { AssetsIo, DecodedImage, Manifest, Texture } from "../../../assets/types";
import type { FeatureFilter } from "../../../flow/types";
import { rendererPlugin } from "../../../renderer";
import { installFakeDom } from "../../../renderer/__tests__/fake-dom";
import {
  type FakeContainer,
  FakeRectangle,
  FakeTexture
} from "../../../renderer/__tests__/fake-pixi";
import { Shape, Transform } from "../../../renderer/components";
import { worldPlugin } from "../../../world";
import type { AnyComponentValue, Entity } from "../../../world/types";
import { effectsPlugin } from "../../index";
import {
  createFakeEffectsPixi,
  type FakeEffectsPixi,
  type FakeFxFilter
} from "../fake-effects-pixi";
import { Frosted, Soft } from "../filter-fixtures";

// ---------------------------------------------------------------------------
// Integration: a backdrop filter on a running app — the real time, flow, world,
// renderer (on the fake Pixi and the fake DOM), assets, anim and effects. The
// frosted panels hang over a scene that is drawn straight to the canvas: the
// renderer asks Pixi for a back buffer, the panels are drawn live, and a change
// of the scene under them draws a frame on demand.
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.unstubAllGlobals();
});

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

/** The bundle of the fixture holds no file. */
const MANIFEST: Manifest = {
  version: 1,
  bundles: { fixture: { feature: "fixture", tier: "boot", mb: 0, files: [] } }
};

/** The two views of the screen, bottom first. */
type Part = { readonly id: "scene" | "panels" };

/** The scene, then the layer of the panels above it. */
const PARTS: readonly Part[] = [{ id: "scene" }, { id: "panels" }];

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
 * Starts an app drawn on demand: a full-screen scene and, above it, a layer of panels under one filter.
 *
 * @param filters - The filter components the feature registers.
 * @param panels - The filter of the panels' layer.
 * @param kind - The backend the fake Pixi draws with.
 * @returns The app and the fake Pixi.
 */
async function startPanels(
  filters: readonly FeatureFilter[],
  panels: AnyComponentValue,
  kind: "webgpu" | "webgl" = "webgpu"
) {
  installFakeDom({ width: 1080, height: 1920 });

  const pixi = createFakeEffectsPixi({ kind });
  const screen = kit.projection({
    name: "fixture.screen",
    layer: "main",
    from: () => PARTS,
    key: (part: Part) => part.id,
    view: (part: Part) =>
      part.id === "scene"
        ? [Transform({ x: 0, y: 0 }), Shape({ kind: "rect", w: 390, h: 844, fill: 0x9f_b7_b4 })]
        : [
            Transform({ x: 0, y: 0 }),
            Shape({ kind: "rect", w: 350, h: 200, fill: 0xff_f8_e7, alpha: 0.4 }),
            panels
          ]
  });
  const home = kit.defineNode({ outcomes: { quit: type() }, rest: true });
  const main = kit.defineFlow("main", {
    nodes: { home },
    start: "home",
    edges: { home: { quit: "home" } }
  });
  const feature = kit.defineFeature("fixture", { flows: [main], projections: [screen], filters });
  const app = createApp({
    plugins: [worldPlugin, rendererPlugin, assetsPlugin, animPlugin, effectsPlugin, feature],
    pluginConfigs: {
      log: { mode: "test" },
      flow: { mainFlow: main },
      model: { initialPlayer: { n: 0 }, initialSession: { n: 0 }, seed: 1 },
      // The warm-up of spec 27 would draw probes and ask for frames: the frames counted here are the views' own.
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
  app.world.projection.mount(["fixture.screen"], { kind: "plugin", name: "test" });

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

describe("a backdrop filter on a running app", () => {
  // Bug: WebGL draws without a back buffer and Pixi skips the panels' filters with a warning in every frame; or every
  // WebGL game pays the back buffer's full-screen copy, also without a backdrop.
  it.each([
    ["webgpu", "a backdrop", true, [Frosted]],
    ["webgl", "a backdrop", true, [Frosted]],
    ["webgl", "no backdrop", false, [Soft]]
  ] as const)("asks Pixi on %s with %s for the back buffer: %s", async (kind, _what, wanted, filters) => {
    const panels = filters[0] === Frosted ? Frosted() : Soft();
    const { app, pixi } = await startPanels(filters, panels, kind);

    expect(pixi.last().initOptions?.useBackBuffer).toBe(wanted);

    await app.stop();
  });

  // Bug: the frosted panels are kept as a picture, or a change of the scene under them asks for no frame: the panels
  // show the blur of an old scene.
  it("draws the panels live, a frame when the scene under them changes, and none at rest", async () => {
    const { app, pixi } = await startPanels([Frosted], Frosted());

    await frames(app, 6);

    const parts = [...app.world.ecs.query(Shape)].map(([entity]) => entity);
    const panels = parts.find(entity => app.world.ecs.get(entity, Frosted) !== undefined) ?? 0;
    const scene: Entity = parts.find(entity => entity !== panels) ?? 0;
    const object = app.renderer.sync.displayOf(panels) as FakeContainer;
    const [filter] = (object.filters ?? []) as readonly FakeFxFilter[];
    const rest = rendersOf(pixi);

    expect(filter?.options.blendRequired).toBe(true);
    expect(app.renderer.stats().kept.pictures).toBe(0);

    await frames(app, 4);

    expect(rendersOf(pixi)).toBe(rest);

    app.world.ecs.set(scene, Shape, { fill: 0x2b_3a_55 });
    await frames(app, 1);

    expect(rendersOf(pixi)).toBe(rest + 1);
    expect(object.filters).toEqual([filter]);

    await app.stop();
  });
});
