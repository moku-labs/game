import { afterEach, describe, expect, it, vi } from "vitest";
import { createCountingClasses, installDrawCounting } from "../../monitor/draw-calls";
import type { DrawCounter } from "../../monitor/types";
import type { PixiModule } from "../../types";
import {
  createDrawTarget,
  createFakePixi,
  FakeGpuBatchAdaptor,
  FakeGpuEncoderSystem,
  FakeGpuGraphicsAdaptor,
  fakeExtensions,
  WEBGPU_PIPES_ADAPTOR,
  WEBGPU_SYSTEM
} from "../fake-pixi";
import { createMockRenderer, type MockRenderer } from "../mock-renderer";

// ---------------------------------------------------------------------------
// Unit test: the dev draw-call counter. Counting subclasses of the three Pixi
// classes that issue every WebGPU draw, swapped in through the extension
// registry before init, and the drawCalls field of stats()
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Two batches, one graphics object of 3 instructions, one encoder draw, one indirect draw. */
const scene = { batches: 2, graphics: [3], draws: 1, indirect: 1 };

/**
 * A counter with nothing counted.
 *
 * @returns The counter.
 */
function freshCounter(): DrawCounter {
  return { frame: 0, last: 0 };
}

/**
 * Runs one frame of the mock: phase input, then phase render.
 *
 * @param mock - The started mock renderer.
 */
function frame(mock: MockRenderer): void {
  mock.runPhase("input");
  mock.runPhase("render");
}

/**
 * Yields the microtask queue, so a restore inside the renderer can finish.
 */
async function tick(): Promise<void> {
  for (let index = 0; index < 20; index += 1) await Promise.resolve();
}

describe("createCountingClasses", () => {
  it("subclasses the three Pixi classes and keeps their extension metadata object", () => {
    const pixi = createFakePixi();
    const classes = createCountingClasses(pixi.module, freshCounter());

    expect(Object.getPrototypeOf(classes.batch)).toBe(FakeGpuBatchAdaptor);
    expect(Object.getPrototypeOf(classes.graphics)).toBe(FakeGpuGraphicsAdaptor);
    expect(Object.getPrototypeOf(classes.encoder)).toBe(FakeGpuEncoderSystem);
    expect(classes.batch.extension).toBe(FakeGpuBatchAdaptor.extension);
    expect(classes.graphics.extension).toBe(FakeGpuGraphicsAdaptor.extension);
    expect(classes.encoder.extension).toBe(FakeGpuEncoderSystem.extension);
  });

  it("counts one draw per batch, one per graphics instruction and one per encoder draw", () => {
    const pixi = createFakePixi();
    const counter = freshCounter();
    const classes = createCountingClasses(pixi.module, counter);
    const renderer = createDrawTarget();
    const pipe = { renderer } as never;

    new classes.batch().execute(pipe, {} as never);
    expect(counter.frame).toBe(1);

    new classes.graphics().execute(pipe, { context: { instructionSize: 3 } } as never);
    expect(counter.frame).toBe(4);

    const encoder = new classes.encoder(renderer as never);

    encoder.draw({} as never);
    encoder.drawIndirect({} as never);

    expect(counter.frame).toBe(6);
    // The base classes still drew: the subclasses only count.
    expect(renderer.drawn).toBe(6);
  });
});

describe("installDrawCounting", () => {
  it("swaps each class for its counting subclass under the same name, and swaps back", () => {
    const pixi = createFakePixi();
    const off = installDrawCounting(pixi.module, freshCounter());
    const batch = fakeExtensions.named(WEBGPU_PIPES_ADAPTOR, "batch");
    const graphics = fakeExtensions.named(WEBGPU_PIPES_ADAPTOR, "graphics");
    const encoder = fakeExtensions.named(WEBGPU_SYSTEM, "encoder");

    expect(batch).not.toBe(FakeGpuBatchAdaptor);
    expect(Object.getPrototypeOf(batch)).toBe(FakeGpuBatchAdaptor);
    expect(Object.getPrototypeOf(graphics)).toBe(FakeGpuGraphicsAdaptor);
    expect(Object.getPrototypeOf(encoder)).toBe(FakeGpuEncoderSystem);

    off();

    expect(fakeExtensions.named(WEBGPU_PIPES_ADAPTOR, "batch")).toBe(FakeGpuBatchAdaptor);
    expect(fakeExtensions.named(WEBGPU_PIPES_ADAPTOR, "graphics")).toBe(FakeGpuGraphicsAdaptor);
    expect(fakeExtensions.named(WEBGPU_SYSTEM, "encoder")).toBe(FakeGpuEncoderSystem);
  });
});

describe("stats().drawCalls", () => {
  it("installs the counter before init in a dev build and reads the draws of the last frame", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const mock = createMockRenderer({ scene });

    await mock.start();

    const app = mock.pixi.last();

    // The application found the counting classes when it was initialised.
    expect(Object.getPrototypeOf(app.drawClasses?.batch)).toBe(FakeGpuBatchAdaptor);
    expect(mock.log.debug).toHaveBeenCalledWith("moku:dev", { command: "renderer.drawCalls" });

    frame(mock);

    expect(app.renderer.frameDraws).toBe(7);
    expect(mock.api.stats().drawCalls).toBe(7);

    frame(mock);

    expect(mock.api.stats().drawCalls).toBe(7);
  });

  it("closes the frame count at the end of the frame and starts the next one at 0", async () => {
    const mock = createMockRenderer();

    await mock.start();

    const draws = mock.ctx.state.monitor.draws;

    draws.frame = 5;
    mock.runPhase("render");

    expect(draws).toEqual({ frame: 0, last: 5 });

    // A draw between two frames, as the extract of a capture, is not a draw of the next frame.
    draws.frame = 3;
    frame(mock);

    expect(draws.last).toBe(0);
  });

  it("leaves the field out and installs nothing without the dev flag", async () => {
    const mock = createMockRenderer({ scene });

    await mock.start();
    frame(mock);

    expect("drawCalls" in mock.api.stats()).toBe(false);
    expect(mock.pixi.last().drawClasses?.batch).toBe(FakeGpuBatchAdaptor);
    expect(mock.ctx.state.host.uninstallCounting).toBeUndefined();
  });

  it("reads 0 on the WebGL fallback, where the three WebGPU classes never draw", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const mock = createMockRenderer({ kind: "webgl", scene });

    await mock.start();
    frame(mock);

    expect(mock.api.stats().drawCalls).toBe(0);
  });

  it("reads 0 while inert in a dev build", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const mock = createMockRenderer({ dom: false });

    await mock.start();

    expect(mock.api.stats().drawCalls).toBe(0);
  });

  it("swaps Pixi's own classes back when the host stops", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const mock = createMockRenderer({ scene });

    await mock.start();

    expect(fakeExtensions.named(WEBGPU_PIPES_ADAPTOR, "batch")).not.toBe(FakeGpuBatchAdaptor);

    mock.stop();

    expect(fakeExtensions.named(WEBGPU_PIPES_ADAPTOR, "batch")).toBe(FakeGpuBatchAdaptor);
    expect(fakeExtensions.named(WEBGPU_PIPES_ADAPTOR, "graphics")).toBe(FakeGpuGraphicsAdaptor);
    expect(fakeExtensions.named(WEBGPU_SYSTEM, "encoder")).toBe(FakeGpuEncoderSystem);
    expect(mock.ctx.state.host.uninstallCounting).toBeUndefined();
    expect(mock.ctx.state.monitor.draws).toEqual({ frame: 0, last: 0 });
  });

  it("reuses the installed classes for the new application after a lost WebGPU device", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const mock = createMockRenderer({ scene });

    await mock.start();

    const first = mock.pixi.last();

    first.lose("unknown");
    await tick();

    const second = mock.pixi.last();

    expect(second).not.toBe(first);
    expect(second.drawClasses?.batch).toBe(first.drawClasses?.batch);

    frame(mock);

    expect(mock.api.stats().drawCalls).toBe(7);
  });

  it("starts without the counter and warns when the Pixi module lacks the draw classes", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const mock: MockRenderer = createMockRenderer({
      config: {
        loadPixi: () =>
          Promise.resolve({
            ...mock.pixi.module,
            GpuBatchAdaptor: undefined
          } as unknown as PixiModule)
      }
    });

    await mock.start();

    expect(mock.api.host.ready()).toBe(true);
    expect(mock.ctx.state.host.uninstallCounting).toBeUndefined();
    expect(fakeExtensions.named(WEBGPU_PIPES_ADAPTOR, "batch")).toBe(FakeGpuBatchAdaptor);
    expect(mock.log.warn).toHaveBeenCalledWith("renderer: draw calls are not counted", {
      error: expect.any(TypeError)
    });
  });
});
