import { afterEach, describe, expect, it, vi } from "vitest";
import { defineGameApp } from "../../../../app";
import { createApp, defineGame, type } from "../../../../index";
import { animPlugin } from "../../../anim";
import { assetsPlugin } from "../../../assets";
import type { AssetsIo, DecodedImage, Manifest, Texture } from "../../../assets/types";
import type { FeatureFilter } from "../../../flow/types";
import { rendererPlugin } from "../../../renderer";
import { installFakeDom } from "../../../renderer/__tests__/fake-dom";
import {
  type FakeContainer,
  type FakeGlContext,
  FakeRectangle,
  FakeTexture
} from "../../../renderer/__tests__/fake-pixi";
import { Shape, Transform } from "../../../renderer/components";
import { worldPlugin } from "../../../world";
import type { AnyComponentValue } from "../../../world/types";
import { defineFilter } from "../../filters/define";
import { effectsPlugin } from "../../index";
import {
  createFakeEffectsPixi,
  type FakeEffectsPixi,
  FakeFxFilter,
  FakeFxGpuProgram
} from "../fake-effects-pixi";
import { Bad, Hazy, SOFT_BODIES, SOFT_STAGES, Soft, SoftDim, softChain } from "../filter-fixtures";

// ---------------------------------------------------------------------------
// Integration: filters that read a second texture on a running app — the real
// time, flow, world, renderer (on the fake Pixi and the fake DOM), assets, anim
// and effects. The checks run in every build; the first scene mounts after
// them; a broken kind draws its fallback; a filter at rest asks for no frame.
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

/** The bundle of the fixture's scene holds no file. */
const MANIFEST: Manifest = {
  version: 1,
  bundles: { fixture: { feature: "fixture", tier: "boot", mb: 0, files: [] } }
};

/** What the WebGPU compiler of the fake says about `Bad`. */
const BAD_ERROR = { type: "error", lineNum: 12, linePos: 3, message: "unresolved 'missing'" };

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
 * Lets the device fail the compile of `Bad`'s WGSL, the way a driver rejects it.
 *
 * @param device - The fake device of the running renderer.
 */
function rejectBad(device: GPUDevice | undefined): void {
  if (device === undefined) throw new Error("no device");

  Object.assign(device, {
    createShaderModule: ({ code }: { code: string }) => ({
      getCompilationInfo: () =>
        Promise.resolve({ messages: code === Bad.filter.source ? [BAD_ERROR] : [] })
    })
  });
}

/**
 * Starts an app with one view of filters, drawn on the fake page, its graph resting on one node.
 *
 * @param filters - The filter components the feature registers.
 * @param view - The components of the one view.
 * @param options - The renderer's demand mode and a hook run once the renderer is ready, before the graph runs.
 * @param options.onDemand - Whether the renderer draws only frames that change.
 * @param options.ready - Called with the started app, before the graph runs.
 * @returns The app and the fake Pixi.
 */
async function startFiltered(
  filters: readonly FeatureFilter[],
  view: readonly AnyComponentValue[],
  options: {
    onDemand?: boolean;
    ready?: (app: { renderer: { host: { device(): GPUDevice | undefined } } }) => void;
  } = {}
) {
  installFakeDom({ width: 1080, height: 1920 });

  const pixi = createFakeEffectsPixi();
  const lamp = kit.projection({
    name: "fixture.lamp",
    layer: "main",
    from: () => ({}),
    view: () => [...view]
  });
  const home = kit.defineNode({ outcomes: { quit: type() }, rest: true });
  const main = kit.defineFlow("main", {
    nodes: { home },
    start: "home",
    edges: { home: { quit: "home" } }
  });
  const feature = kit.defineFeature("fixture", { flows: [main], projections: [lamp], filters });
  const app = createApp({
    plugins: [worldPlugin, rendererPlugin, assetsPlugin, animPlugin, effectsPlugin, feature],
    pluginConfigs: {
      log: { mode: "test" },
      flow: { mainFlow: main },
      model: { initialPlayer: { n: 0 }, initialSession: { n: 0 }, seed: 1 },
      // The warm-up of spec 27 would draw probes and ask for frames: the frames and filters counted here are the
      // views' own.
      renderer: {
        mount: "#game",
        onDemand: options.onDemand === true,
        loadPixi: () => Promise.resolve(pixi.module),
        warm: 0
      },
      assets: { manifest: MANIFEST, io: createIo() }
    }
  });

  await app.start();
  options.ready?.(app);
  app.flow.run().catch(() => undefined);
  await tick();
  app.world.projection.setLayers([{ name: "main", sort: "order" }]);
  app.world.projection.mount(["fixture.lamp"], { kind: "plugin", name: "test" });

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

/**
 * The fake filters built over one definition's programs.
 *
 * @param source - The definition's assembled WGSL.
 * @returns The filters.
 */
function filtersOver(source: string): FakeFxFilter[] {
  return FakeFxFilter.made.filter(
    filter =>
      (filter.options.gpuProgram as { options: { fragment: { source: string } } } | undefined)
        ?.options.fragment.source === source
  );
}

describe("filter inputs on a running app", () => {
  it("draws a chain, counts the main body and every step, and asks for no frame at rest", async () => {
    const chain = vi.fn(softChain);
    const Lamp = defineFilter("fixture.lamp", {
      ...SOFT_BODIES,
      uniforms: { spread: 1, tone: 0 },
      inputs: { soft: { stages: SOFT_STAGES, chain } }
    });
    const { app, pixi } = await startFiltered(
      [Lamp],
      [
        Transform({ x: 0, y: 0 }),
        Shape({ kind: "rect", w: 390, h: 844, fill: 0x9f_b7_b4 }),
        Lamp()
      ],
      { onDemand: true }
    );

    await frames(app, 6);

    const renders = rendersOf(pixi);

    expect(renders).toBeGreaterThan(0);

    await frames(app, 10);

    expect(rendersOf(pixi)).toBe(renders);
    expect(chain).toHaveBeenCalledTimes(1);
    // The frame, the view's content, the main body and two steps at one real pixel per CSS pixel.
    expect(app.effects.stats().renderPasses).toBe(5);

    await app.stop();
  });

  it("leaves a view of a kind whose stage does not compile drawn by its fallback, never by the broken definition", async () => {
    const { app } = await startFiltered(
      [Soft, Hazy],
      [Transform({ x: 0, y: 0 }), Shape({ kind: "rect", w: 40, h: 40, fill: 0x33_33_33 }), Hazy()],
      { ready: started => rejectBad(started.renderer.host.device()) }
    );
    const drawn: unknown[][] = [];

    for (let frame = 0; frame < 6; frame += 1) {
      await frames(app, 1);

      const [entity] = [...app.world.ecs.query(Hazy)].map(([found]) => found);
      const object =
        entity === undefined
          ? undefined
          : (app.renderer.sync.displayOf(entity) as FakeContainer | undefined);

      drawn.push([...(object?.filters ?? [])]);
    }

    const [fallback] = filtersOver(SoftDim.filter.source);

    expect(filtersOver(Hazy.filter.source)).toEqual([]);
    expect(filtersOver(Bad.filter.source)).toEqual([]);
    expect(drawn.every(filters => filters.length === 1 && filters[0] === fallback)).toBe(true);
    expect(
      app.log
        .trace()
        .filter(entry => entry.event === "effects:broken")
        .map(entry => entry.data)
    ).toEqual([
      {
        filter: "fixture.hazy",
        reason: "compile",
        stage: "fixture.bad",
        fallback: "fixture.softDim",
        message:
          'Its stage "fixture.bad" does not compile on this device: read the effects:wgsl or effects:glsl lines.'
      }
    ]);

    await app.stop();
  });

  it("destroys the filters of the chain with the filter", async () => {
    const { app } = await startFiltered(
      [Soft],
      [Transform({ x: 0, y: 0 }), Shape({ kind: "rect", w: 40, h: 40, fill: 0x33_33_33 }), Soft()]
    );

    await frames(app, 3);

    const stages = SOFT_STAGES.flatMap(stage => filtersOver(stage.filter.source));
    const [entity] = [...app.world.ecs.query(Soft)].map(([found]) => found);

    expect(stages).toHaveLength(2);

    app.world.ecs.remove(entity ?? 0, Soft);
    await frames(app, 3);

    expect(stages.map(filter => filter.destroyed)).toEqual([true, true]);

    await app.stop();
  });
});

const sceneLamp = kit.projection({
  name: "fixture.lamp",
  layer: "main",
  from: () => ({}),
  view: () => [
    Transform({ x: 0, y: 0 }),
    Shape({ kind: "rect", w: 390, h: 844, fill: 0x9f_b7_b4 }),
    Soft()
  ]
});

const rest = kit.defineNode({
  scene: "main",
  outcomes: { never: type() },
  rest: true,
  checkpoint: true
});

const sceneFlow = kit.defineFlow("main", {
  nodes: { rest },
  start: "rest",
  edges: { rest: { never: "rest" } }
});

const sceneMain = kit.defineScene("main", {
  bundle: "fixture",
  layers: { main: { sort: "order" } },
  projections: [sceneLamp]
});

const sceneFeature = kit.defineFeature("fixture", {
  scenes: [sceneMain],
  projections: [sceneLamp],
  filters: [Soft]
});

describe("the boot waits for the shader checks", () => {
  it("mounts the first scene with its filtered views already filtered", async () => {
    installFakeDom({ width: 1080, height: 1920 });

    const pixi = createFakeEffectsPixi({ kind: "webgl" });
    const { app } = defineGameApp({
      flow: sceneFlow,
      safeNode: "rest",
      player: { n: 0 },
      session: { n: 0 },
      referenceSide: 390,
      features: [sceneFeature],
      pluginConfigs: { log: { mode: "test" } }
    }).screen({
      manifest: MANIFEST,
      io: createIo(),
      renderer: { mount: "#game", loadPixi: () => Promise.resolve(pixi.module) }
    });

    await app.start();

    // The driver compiles in the background and answers after five frames.
    const gl = app.renderer.host.gl() as unknown as FakeGlContext;
    const COMPLETION = 0x91_b1;
    let elapsed = 0;

    gl.extensions.KHR_parallel_shader_compile = { COMPLETION_STATUS_KHR: COMPLETION };
    gl.getShaderParameter = (_shader: unknown, name: number) => name !== COMPLETION || elapsed >= 5;

    app.flow.run().catch(() => undefined);

    const mounted: Array<{ frame: number; filtered: boolean }> = [];

    for (let frame = 0; frame < 20; frame += 1) {
      elapsed = frame;
      await frames(app, 1);

      const [entity] = [...app.world.ecs.query(Soft)].map(([found]) => found);
      const object =
        entity === undefined
          ? undefined
          : (app.renderer.sync.displayOf(entity) as FakeContainer | undefined);

      if (object !== undefined)
        mounted.push({ frame, filtered: (object.filters ?? []).length === 1 });
    }

    const events = app.log.trace().map(entry => entry.event);

    expect(mounted.length).toBeGreaterThan(0);
    expect(mounted[0]?.frame).toBeGreaterThanOrEqual(5);
    expect(mounted.every(entry => entry.filtered)).toBe(true);
    expect(events).toContain("effects:mount-waited");
    expect(events).toContain("effects:checks");
    expect(events).not.toContain("effects:check-pending");
    expect(FakeFxGpuProgram.made.length).toBeGreaterThan(0);

    await app.stop();
  });
});
