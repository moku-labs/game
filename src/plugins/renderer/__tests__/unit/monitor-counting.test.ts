/* eslint-disable unicorn/no-null -- a frame record and a log line are JSON: "not measured" is null. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCountingClasses, installCounting } from "../../monitor/draw-calls";
import { frameAt } from "../../monitor/ring";
import { createSinks } from "../../monitor/state";
import { COUNT, type MonitorSinks } from "../../monitor/types";
import {
  createFakePixi,
  FakeBatcherPipe,
  FakeFilterSystem,
  FakeGlTextureSystem,
  FakeGpuBatchAdaptor,
  FakeGpuEncoderSystem,
  FakeGpuGraphicsAdaptor,
  FakeGpuTextureSystem,
  type FakeRenderTarget,
  fakeExtensions,
  WEBGL_PIPES,
  WEBGL_SYSTEM,
  WEBGPU_PIPES,
  WEBGPU_PIPES_ADAPTOR,
  WEBGPU_SYSTEM
} from "../fake-pixi";
import { startAgent } from "../perf-harness";

// ---------------------------------------------------------------------------
// Unit: the counting subclasses of a dev or debug build (spec 11 R4): passes
// where Pixi begins them, the timestamp resolve before the submit, filter
// applies with their pixels, uploads with their bytes, the swap of six classes.
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** The encoder, filter and texture classes of a fresh fake module, counting into `sinks`. */
function counting(sinks: MonitorSinks) {
  const pixi = createFakePixi();
  const classes = createCountingClasses(pixi.module, sinks);
  const target: FakeRenderTarget = { isRoot: true, pixelWidth: 1080, pixelHeight: 1920 };
  const renderer = { drawn: 0, renderTarget: { renderTarget: target } };
  const Encoder = classes.encoder as unknown as new (renderer: unknown) => FakeGpuEncoderSystem;
  const Filters = classes.filter as unknown as new () => FakeFilterSystem;

  return { encoder: new Encoder(renderer), filters: new Filters(), classes, target };
}

/** Calls the protected upload hook of a texture system. */
function upload(system: unknown, source: object): void {
  (system as { onSourceUpdate(source: object): void }).onSourceUpdate(source);
}

describe("the counting encoder", () => {
  it("counts a pass and a stencil pass only inside a frame and hands them to the pass sink", () => {
    const sinks = createSinks();
    const begin = vi.fn();
    const { encoder, target } = counting(sinks);

    sinks.passes = { begin, resolve: vi.fn() };
    encoder.beginRenderPass({ descriptor: {} });

    expect(sinks.counts[COUNT.passes]).toBe(0);
    expect(begin).not.toHaveBeenCalled();

    sinks.inFrame = true;
    encoder.beginRenderPass({ descriptor: {} });
    encoder.beginRenderPass({ descriptor: { depthStencilAttachment: {} } });

    expect(sinks.counts[COUNT.passes]).toBe(2);
    expect(sinks.counts[COUNT.stencilPasses]).toBe(1);
    expect(begin).toHaveBeenLastCalledWith({ depthStencilAttachment: {} }, target);
    expect(encoder.calls).toEqual(["begin", "begin", "begin"]);
  });

  it("resolves the timestamps after the last pass ended and before Pixi submits", () => {
    const sinks = createSinks();
    const { encoder } = counting(sinks);

    sinks.passes = { begin: vi.fn(), resolve: () => encoder.calls.push("resolve") };
    encoder.postrender();

    expect(encoder.calls).toEqual(["finish", "resolve", "submit"]);
  });
});

describe("the counting filter system", () => {
  it("adds each apply of a frame and its pixels, width times height times resolution squared", () => {
    const sinks = createSinks();
    const { filters } = counting(sinks);
    const input = { frame: { width: 10, height: 20 }, source: { resolution: 2 } };
    let depth = Number.NaN;

    FakeFilterSystem.onApply = () => {
      depth = sinks.filterDepth;
    };
    filters.applyFilter({}, input, {}, true);

    expect(sinks.counts[COUNT.filterApplies]).toBe(0);

    sinks.inFrame = true;
    filters.applyFilter({}, input, {}, true);
    filters.applyFilter({}, input, {}, false);

    expect(sinks.counts[COUNT.filterApplies]).toBe(2);
    expect(sinks.counts[COUNT.filterPixels]).toBe(1600);
    expect(sinks.kindApplies[0]).toBe(2);
    expect(depth).toBe(1);
    expect(sinks.filterDepth).toBe(0);
    expect(filters.applied).toHaveLength(3);
  });
});

describe("the counting texture systems", () => {
  it("count an image upload with its bytes, a compressed one by its levels, and skip a render target", () => {
    const sinks = createSinks();
    const { classes } = counting(sinks);
    const gpu = new (classes.gpuTexture as unknown as new () => FakeGpuTextureSystem)();
    const gl = new (classes.glTexture as unknown as new () => FakeGlTextureSystem)();

    upload(gpu, { uploadMethodId: "image", resource: {}, pixelWidth: 4, pixelHeight: 2 });
    upload(gl, { uploadMethodId: "image", resource: {}, pixelWidth: 8, pixelHeight: 8 });
    upload(gpu, {
      uploadMethodId: "compressed",
      resource: [new Uint8Array(100), new Uint8Array(25)],
      pixelWidth: 16,
      pixelHeight: 16
    });
    upload(gpu, { uploadMethodId: "unknown", resource: null, pixelWidth: 512, pixelHeight: 512 });
    // A source Pixi cannot upload is not an upload, whatever it holds.
    upload(gl, { uploadMethodId: "unknown", resource: {}, pixelWidth: 64, pixelHeight: 64 });

    expect(sinks.counts[COUNT.uploads]).toBe(3);
    expect(sinks.counts[COUNT.uploadBytes]).toBe(32 + 256 + 125);
    expect(gpu.uploaded).toHaveLength(3);
    expect(gl.uploaded).toHaveLength(2);
  });
});

describe("the counting batcher pipe", () => {
  it("counts every instruction rebuild in the window, and in the frame's counter only inside a frame", () => {
    const sinks = createSinks();
    const classes = createCountingClasses(createFakePixi().module, sinks);
    const Pipe = classes.batcher as unknown as new () => FakeBatcherPipe;
    const pipe = new Pipe();

    pipe.buildStart({});
    sinks.inFrame = true;
    pipe.buildStart({});
    pipe.buildStart({});

    expect(pipe.builds).toBe(3);
    expect(sinks.rebuildsWindow).toBe(3);
    expect(sinks.counts[COUNT.rebuilds]).toBe(2);
  });
});

describe("installCounting", () => {
  it("swaps the seven classes for their counting subclasses under the same names, and swaps back", () => {
    const pixi = createFakePixi();
    const off = installCounting(pixi.module, createSinks());
    const named = [
      [WEBGPU_PIPES, "batch", FakeBatcherPipe],
      [WEBGL_PIPES, "batch", FakeBatcherPipe],
      [WEBGPU_PIPES_ADAPTOR, "batch", FakeGpuBatchAdaptor],
      [WEBGPU_PIPES_ADAPTOR, "graphics", FakeGpuGraphicsAdaptor],
      [WEBGPU_SYSTEM, "encoder", FakeGpuEncoderSystem],
      [WEBGPU_SYSTEM, "filter", FakeFilterSystem],
      [WEBGL_SYSTEM, "filter", FakeFilterSystem],
      [WEBGPU_SYSTEM, "texture", FakeGpuTextureSystem],
      [WEBGL_SYSTEM, "texture", FakeGlTextureSystem]
    ] as const;

    for (const [type, name, base] of named) {
      expect(Object.getPrototypeOf(fakeExtensions.named(type, name))).toBe(base);
    }

    off();

    for (const [type, name, base] of named) expect(fakeExtensions.named(type, name)).toBe(base);
  });
});

describe("the pass kinds of WebGPU", () => {
  it("records the root as canvas, a pass inside a filter apply as filter, another target as texture with its label", async () => {
    const agent = await startAgent({ config: { monitor: { budgetMs: 16.7, frames: 64 } } });
    const Encoder = fakeExtensions.named(WEBGPU_SYSTEM, "encoder") as unknown as new (
      renderer: unknown
    ) => FakeGpuEncoderSystem;
    const bound: { renderTarget: FakeRenderTarget } = {
      renderTarget: { isRoot: true, pixelWidth: 1080, pixelHeight: 1920 }
    };
    const encoder = new Encoder({ renderTarget: bound });

    agent.mock.frames.push({
      phase: "render",
      callback: () => {
        encoder.beginRenderPass({ descriptor: {} });
        bound.renderTarget = {
          isRoot: false,
          pixelWidth: 256,
          pixelHeight: 128,
          colorTexture: { label: "kept:ward.scene" }
        };
        encoder.beginRenderPass({ descriptor: {} });
        bound.renderTarget = { isRoot: false, pixelWidth: 64, pixelHeight: 64, label: "glow" };
        agent.pc.sinks.filterDepth = 1;
        encoder.beginRenderPass({ descriptor: {} });
        agent.pc.sinks.filterDepth = 0;
      }
    });
    agent.frame({ workMs: 1 });

    expect(frameAt(agent.mock.api.monitor.frames(), 0)?.passes).toBe(3);
    expect(agent.pc.perf.ring.passes.label.slice(0, 3)).toEqual([null, "kept:ward.scene", "glow"]);
    expect([...agent.pc.perf.ring.passes.kind.subarray(0, 3)]).toEqual([0, 1, 2]);
  });
});
