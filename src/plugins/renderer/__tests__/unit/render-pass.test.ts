import * as pixi from "pixi.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLazyCanvasClasses, installLazyCanvasPass } from "../../host/render-pass";
import { createCountingClasses } from "../../monitor/draw-calls";
import { createSinks } from "../../monitor/state";
import { COUNT } from "../../monitor/types";
import type { PixiModule } from "../../types";
import {
  createFakePixi,
  FakeGpuRenderTargetSystem,
  FakeGpuStencilSystem,
  FakePipelineSystem,
  fakeExtensions,
  WEBGPU_SYSTEM
} from "../fake-pixi";
import { createMockRenderer, type MockRenderer } from "../mock-renderer";
import { createPassStage, type PassStage, STAGE_CLEAR } from "../pass-stage";

// ---------------------------------------------------------------------------
// B3 of change 2026-10-18-memory-render: the canvas pass begins at the first
// draw into the canvas, not at render start, and the canvas's stencil and
// depth are cleared and discarded around a filter break where nothing reads
// them. Real Pixi systems over a recording stand-in of the GPU (pass-stage).
// The first block pins Pixi's own behaviour, the claim the change rests on.
// ---------------------------------------------------------------------------

/** The real module, as the renderer types it. */
const module = pixi as unknown as PixiModule;

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * A stage over the lazy canvas pass.
 *
 * @param encoder - The encoder class; Pixi's own when left out.
 * @returns The stage.
 */
function lazyStage(encoder?: typeof pixi.GpuEncoderSystem): PassStage {
  const classes = createLazyCanvasClasses(module);

  return createPassStage({
    targets: classes.targets,
    pipeline: classes.pipeline,
    ...(encoder === undefined ? {} : { encoder })
  });
}

/**
 * A stage over Pixi's own render target and pipeline systems.
 *
 * @returns The stage.
 */
function pixiStage(): PassStage {
  return createPassStage({ targets: pixi.GpuRenderTargetSystem, pipeline: pixi.PipelineSystem });
}

/**
 * A frame with a stencil mask around a filter: the canvas gets its depth-stencil attachment at the first one.
 *
 * @param stage - The stage.
 * @returns The passes of the frame.
 */
function maskedFrame(stage: PassStage): readonly string[] {
  return stage.frame(() => {
    stage.pushMask();
    stage.withFilter(stage.draw);
    stage.popMask();
  });
}

/**
 * A frame without a mask: a draw, then a filter.
 *
 * @param stage - The stage.
 * @returns The passes of the frame.
 */
function plainFrame(stage: PassStage): readonly string[] {
  return stage.frame(() => {
    stage.draw();
    stage.withFilter(stage.draw);
  });
}

describe("Pixi's own canvas pass (the claim the change rests on)", () => {
  it("opens the canvas at render start: a frame that starts with a filter pays an empty pass and a reload", () => {
    const stage = pixiStage();

    expect(stage.frame(() => stage.withFilter(stage.draw))).toEqual([
      "canvas: clear, 0 draws",
      "filter input: clear, 1 draws",
      "canvas: load, 1 draws"
    ]);
  });

  it("stores and reloads the canvas's stencil and depth at every break, with no mask open", () => {
    const stage = pixiStage();

    maskedFrame(stage);

    expect(plainFrame(stage)).toEqual([
      "canvas: clear, stencil clear/store, depth clear/store, 1 draws",
      "filter input: clear, 1 draws",
      "canvas: load, stencil load/store, depth load/store, 1 draws"
    ]);
  });
});

describe("the lazy canvas pass", () => {
  it("opens the canvas once, after a leading filter, and clears it there to the frame's colour", () => {
    const stage = lazyStage();

    expect(stage.frame(() => stage.withFilter(stage.draw))).toEqual([
      "filter input: clear, 1 draws",
      "canvas: clear, 1 draws"
    ]);
    expect(stage.gpu.passes.at(-1)?.clearValue).toEqual(STAGE_CLEAR);
  });

  it("clears a canvas drawn before a filter in its first pass and loads it after the filter", () => {
    const stage = lazyStage();

    expect(plainFrame(stage)).toEqual([
      "canvas: clear, 1 draws",
      "filter input: clear, 1 draws",
      "canvas: load, 1 draws"
    ]);
  });

  it("begins the canvas pass at a batch's geometry, the first thing a batch sets", () => {
    const stage = lazyStage();

    expect(stage.frame(() => stage.drawBatch())).toEqual(["canvas: clear, 1 draws"]);
  });

  it("keeps the open canvas pass when the canvas is bound again without a clear", () => {
    const stage = lazyStage();

    expect(
      stage.frame(() => {
        stage.draw();
        stage.bindCanvas();
        stage.draw();
      })
    ).toEqual(["canvas: clear, 2 draws"]);
  });

  it("begins the canvas pass before a render bundle is replayed into it", () => {
    const stage = lazyStage();

    expect(stage.frame(() => stage.replayBundle())).toEqual(["canvas: clear, 0 draws"]);
  });

  it("still clears the canvas once in a frame that draws nothing, and presents a frame that keeps it", () => {
    const stage = lazyStage();

    expect(stage.frame(() => undefined)).toEqual(["canvas: clear, 0 draws"]);
    expect(stage.frame(() => undefined, false)).toEqual(["canvas: load, 0 draws"]);
  });

  it("clears the canvas at the end of a frame whose draws all went into a texture", () => {
    const stage = lazyStage();

    expect(stage.frame(() => stage.offscreen(stage.draw))).toEqual([
      "filter input: clear, 1 draws",
      "canvas: clear, 0 draws"
    ]);
  });

  it("pays the clear it owes before the canvas is read", () => {
    const stage = lazyStage();

    stage.frame(() => {
      stage.copyCanvas();
      stage.withFilter(stage.draw);
    });

    expect(stage.gpu.log).toEqual([
      "begin canvas",
      "end",
      "copy canvas",
      "begin filter input",
      "end",
      "begin canvas",
      "end"
    ]);
    expect(stage.gpu.passes.map(pass => pass.load)).toEqual(["clear", "clear", "load"]);
  });

  it("keeps the stencil a mask was drawn into across a filter inside the mask", () => {
    const stage = lazyStage();

    expect(maskedFrame(stage)).toEqual([
      "canvas: clear, stencil clear/store, depth clear/discard, 1 draws",
      "filter input: clear, 1 draws",
      "canvas: load, stencil load/store, depth clear/discard, 2 draws"
    ]);
  });

  it("clears and discards the stencil and depth of the canvas once a frame went by without a mask", () => {
    const stage = lazyStage();

    maskedFrame(stage);

    // The frame after a mask still keeps the stencil: a mask may come back.
    expect(plainFrame(stage)).toEqual([
      "canvas: clear, stencil clear/store, depth clear/discard, 1 draws",
      "filter input: clear, 1 draws",
      "canvas: load, stencil clear/store, depth clear/discard, 1 draws"
    ]);
    expect(plainFrame(stage)).toEqual([
      "canvas: clear, stencil clear/discard, depth clear/discard, 1 draws",
      "filter input: clear, 1 draws",
      "canvas: load, stencil clear/discard, depth clear/discard, 1 draws"
    ]);
  });

  it("begins the canvas pass again, its stencil kept, when a mask comes into a pass that discards it", () => {
    const stage = lazyStage();

    maskedFrame(stage);
    plainFrame(stage);
    plainFrame(stage);

    expect(
      stage.frame(() => {
        stage.draw();
        stage.pushMask();
        stage.withFilter(stage.draw);
        stage.popMask();
      })
    ).toEqual([
      "canvas: clear, stencil clear/discard, depth clear/discard, 1 draws",
      "canvas: load, stencil clear/store, depth clear/discard, 1 draws",
      "filter input: clear, 1 draws",
      "canvas: load, stencil load/store, depth clear/discard, 2 draws"
    ]);
  });

  it("begins nothing again in frames that keep their masks", () => {
    const stage = lazyStage();

    maskedFrame(stage);
    maskedFrame(stage);

    expect(maskedFrame(stage)).toEqual([
      "canvas: clear, stencil clear/store, depth clear/discard, 1 draws",
      "filter input: clear, 1 draws",
      "canvas: load, stencil load/store, depth clear/discard, 2 draws"
    ]);
  });

  it("keeps the canvas's depth from the first draw that tests or writes it on", () => {
    const stage = lazyStage();

    maskedFrame(stage);
    plainFrame(stage);

    expect(
      stage.frame(() => {
        stage.draw();
        stage.drawDepth();
        stage.withFilter(stage.draw);
      })
    ).toEqual([
      "canvas: clear, stencil clear/discard, depth clear/discard, 1 draws",
      "canvas: load, stencil clear/discard, depth clear/store, 1 draws",
      "filter input: clear, 1 draws",
      "canvas: load, stencil clear/discard, depth load/store, 1 draws"
    ]);
  });

  it("keeps the canvas's depth from a copy of it on", () => {
    const stage = lazyStage();

    maskedFrame(stage);
    plainFrame(stage);
    stage.frame(() => {
      stage.draw();
      stage.copyCanvasDepth();
    });

    expect(plainFrame(stage)).toEqual([
      "canvas: clear, stencil clear/discard, depth clear/store, 1 draws",
      "filter input: clear, 1 draws",
      "canvas: load, stencil clear/discard, depth load/store, 1 draws"
    ]);
  });

  it("leaves a canvas with multisampling to Pixi, whose restore reads the canvas", () => {
    const classes = createLazyCanvasClasses(module);
    const stage = createPassStage({ ...classes, antialias: true });

    expect(stage.frame(() => stage.withFilter(stage.draw))).toEqual([
      "canvas: clear, 0 draws",
      "filter input: clear, 1 draws",
      "canvas: load, 1 draws"
    ]);
  });

  it("is counted by the monitor for the passes that ran", () => {
    const sinks = createSinks();
    const stage = lazyStage(createCountingClasses(module, sinks).encoder);

    sinks.inFrame = true;
    stage.frame(() => stage.withFilter(stage.draw));

    expect(sinks.counts[COUNT.passes]).toBe(2);
  });
});

/**
 * Builds the systems of a real WebGPU renderer: `init` adds every system, then stops at the first thing it needs a
 * page for.
 *
 * @returns The renderer.
 */
async function realRenderer(): Promise<pixi.WebGPURenderer> {
  const renderer = new pixi.WebGPURenderer();

  await renderer.init({ skipExtensionImports: true }).catch(() => undefined);

  return renderer;
}

describe("installLazyCanvasPass", () => {
  it("builds a renderer with its render target and pipeline systems, the stencil system after them, and Pixi's own back once removed", async () => {
    const off = installLazyCanvasPass(module);

    try {
      const lazy = await realRenderer();

      expect(lazy.renderTarget).toBeInstanceOf(pixi.GpuRenderTargetSystem);
      expect(lazy.renderTarget.constructor).not.toBe(pixi.GpuRenderTargetSystem);
      expect(lazy.pipeline.constructor).not.toBe(pixi.PipelineSystem);
      expect(lazy.stencil).toBeInstanceOf(pixi.GpuStencilSystem);
    } finally {
      off();
    }

    const own = await realRenderer();

    expect(own.renderTarget.constructor).toBe(pixi.GpuRenderTargetSystem);
    expect(own.pipeline.constructor).toBe(pixi.PipelineSystem);
    expect(own.stencil).toBeInstanceOf(pixi.GpuStencilSystem);
  });

  it("installs into the engine's test module too, the stencil system last, and takes itself out", () => {
    const fake = createFakePixi();
    const off = installLazyCanvasPass(fake.module);
    const names = (): Array<string | undefined> =>
      (fakeExtensions.lists.get(WEBGPU_SYSTEM) ?? []).slice(-3).map(entry => entry.name);

    expect(fakeExtensions.named(WEBGPU_SYSTEM, "renderTarget")).not.toBe(FakeGpuRenderTargetSystem);
    expect(fakeExtensions.named(WEBGPU_SYSTEM, "pipeline")).not.toBe(FakePipelineSystem);
    expect(names()).toEqual(["renderTarget", "stencil", "pipeline"]);

    off();

    expect(fakeExtensions.named(WEBGPU_SYSTEM, "renderTarget")).toBe(FakeGpuRenderTargetSystem);
    expect(fakeExtensions.named(WEBGPU_SYSTEM, "stencil")).toBe(FakeGpuStencilSystem);
    expect(fakeExtensions.named(WEBGPU_SYSTEM, "pipeline")).toBe(FakePipelineSystem);
  });
});

describe("the host and the lazy canvas pass", () => {
  // Bug: the systems are never installed, or Pixi's own are not put back for the next application on the page.
  it("is installed before init in every build and swapped back when the host stops", async () => {
    const mock = createMockRenderer();

    await mock.start();

    expect(fakeExtensions.named(WEBGPU_SYSTEM, "renderTarget")).not.toBe(FakeGpuRenderTargetSystem);
    expect(fakeExtensions.named(WEBGPU_SYSTEM, "pipeline")).not.toBe(FakePipelineSystem);

    mock.stop();

    expect(fakeExtensions.named(WEBGPU_SYSTEM, "renderTarget")).toBe(FakeGpuRenderTargetSystem);
    expect(fakeExtensions.named(WEBGPU_SYSTEM, "pipeline")).toBe(FakePipelineSystem);
    expect(mock.ctx.state.host.uninstallRenderPass).toBeUndefined();
  });

  it("starts on Pixi's own systems and warns when the module lacks them", async () => {
    const mock: MockRenderer = createMockRenderer({
      config: {
        loadPixi: () =>
          Promise.resolve({
            ...mock.pixi.module,
            PipelineSystem: undefined
          } as unknown as PixiModule)
      }
    });

    await mock.start();

    expect(mock.api.host.ready()).toBe(true);
    expect(mock.ctx.state.host.uninstallRenderPass).toBeUndefined();
    expect(fakeExtensions.named(WEBGPU_SYSTEM, "renderTarget")).toBe(FakeGpuRenderTargetSystem);
    expect(mock.log.warn).toHaveBeenCalledWith(
      "renderer: the canvas pass begins at render start",
      expect.objectContaining({ error: expect.any(TypeError) })
    );
    mock.stop();
  });
});
