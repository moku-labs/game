import { afterEach, describe, expect, it, vi } from "vitest";
import { sourceBytes } from "../../host/readback";
import { createMonitorState } from "../../monitor/state";
import { beginFrame, endFrame } from "../../monitor/window";
import { FAKE_PNG } from "../fake-pixi";
import { createMockRenderer, type MockRenderer } from "../mock-renderer";

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * Runs one frame of the mock: phase input at `at`, phase render `workMs` later.
 *
 * @param mock - The started mock renderer.
 * @param at - Clock time of the frame start.
 * @param workMs - How long the frame takes.
 */
function frame(mock: MockRenderer, at: number, workMs: number): void {
  mock.setNow(at);
  mock.runPhase("input");
  mock.setNow(at + workMs);
  mock.runPhase("render");
}

/**
 * Starts a mock renderer on the fake DOM.
 *
 * @returns The started mock.
 */
async function started(): Promise<MockRenderer> {
  const mock = createMockRenderer();

  await mock.start();

  return mock;
}

/**
 * Lets the promise callbacks queued so far run.
 */
async function settle(): Promise<void> {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
}

describe("renderer stats", () => {
  it("answers zeros while inert, with no draw-call field", () => {
    const mock = createMockRenderer({ dom: false });
    const stats = mock.api.stats();

    expect(stats).toEqual({ fps: 0, frameMs: 0, textures: 0, textureMb: 0, views: 0, pooled: 0 });
    expect("drawCalls" in stats).toBe(false);
  });

  it("measures frames per second and the mean frame work over one second of clock time", async () => {
    const mock = await started();

    // 51 frames 20 ms apart: 50 intervals make the first full second.
    for (let index = 0; index <= 50; index += 1) frame(mock, index * 20, 4);

    expect(mock.api.stats()).toMatchObject({ fps: 50, frameMs: 4 });
  });

  it("reads 0 fps before the first full second", async () => {
    const mock = await started();

    for (let index = 0; index < 10; index += 1) frame(mock, index * 16, 3);

    expect(mock.api.stats()).toMatchObject({ fps: 0, frameMs: 0 });
  });

  it("reads 0 fps when no frame was drawn in the last second, as on a paused clock", async () => {
    const mock = await started();

    for (let index = 0; index <= 50; index += 1) frame(mock, index * 20, 4);
    mock.setNow(50 * 20 + 1500);

    expect(mock.api.stats().fps).toBe(0);
  });

  it("restarts the window after a long gap instead of counting it as one slow frame", () => {
    const state = createMonitorState();

    beginFrame(state, 0);
    endFrame(state, 2);
    beginFrame(state, 16);
    beginFrame(state, 5000);

    expect(state.windowMs).toBe(0);
    expect(state.intervals).toBe(0);
    expect(state.lastStart).toBe(5000);
  });

  it("ignores the end of a frame whose start it never saw", () => {
    const state = createMonitorState();

    endFrame(state, 10);

    expect(state.frames).toBe(0);
    expect(state.workMs).toBe(0);
  });

  it("counts the GPU textures and their memory, mip levels included", async () => {
    const mock = await started();

    mock.pixi
      .last()
      .renderer.texture.managedTextures.push(
        { pixelWidth: 1024, pixelHeight: 1024, mipLevelCount: 1 },
        { pixelWidth: 512, pixelHeight: 512, mipLevelCount: 1 }
      );

    // (1024 * 1024 + 512 * 512) * 4 bytes = 5 MiB.
    expect(mock.api.stats()).toMatchObject({ textures: 2, textureMb: 5 });
  });

  it("answers no texture for Pixi's canvas renderer, which keeps none on a GPU", async () => {
    const mock = await started();

    (mock.pixi.last().renderer as unknown as { texture: object }).texture = {};

    expect(mock.api.stats()).toMatchObject({ textures: 0, textureMb: 0 });
  });

  it("counts the views of sync and the pooled objects", async () => {
    const mock = await started();

    mock.ctx.state.sync.views.set(1, {} as never);
    mock.ctx.state.sync.views.set(2, {} as never);
    mock.ctx.state.sync.pooled = 3;

    expect(mock.api.stats()).toMatchObject({ views: 2, pooled: 3 });
  });

  it("estimates the bytes of one texture source", () => {
    expect(sourceBytes({ pixelWidth: 4, pixelHeight: 4, mipLevelCount: 1 })).toBe(64);
    // 4x4, 2x2, 1x1 at 4 bytes a pixel.
    expect(sourceBytes({ pixelWidth: 4, pixelHeight: 4, mipLevelCount: 3 })).toBe(84);
    // A level never gets smaller than one pixel.
    expect(sourceBytes({ pixelWidth: 2, pixelHeight: 1, mipLevelCount: 3 })).toBe(16);
  });

  it("answers a fresh object every call", async () => {
    const mock = await started();

    expect(mock.api.stats()).not.toBe(mock.api.stats());
  });
});

describe("renderer capture", () => {
  it("answers undefined in a production build, where the dev flag is not defined", async () => {
    const mock = await started();

    await expect(mock.api.capture()).resolves.toBeUndefined();
    expect(mock.pixi.last().renderer.extract.calls).toHaveLength(0);
  });

  it("answers undefined while headless, even in a dev build", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const mock = createMockRenderer({ dom: false });

    await expect(mock.api.capture()).resolves.toBeUndefined();
  });

  it("takes the stage as a PNG right after the next frame is drawn", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const mock = await started();
    const app = mock.pixi.last();
    let url: string | undefined;
    const pending = mock.api.capture().then(value => {
      url = value;
    });

    await settle();

    expect(app.renderer.extract.calls).toHaveLength(0);

    const renders = app.renderer.renders;

    frame(mock, 0, 2);
    await pending;

    expect(app.renderer.renders).toBe(renders + 1);
    expect(url).toBe(FAKE_PNG);
    expect(app.renderer.extract.calls).toEqual([
      { target: app.stage, frame: app.screen, clearColor: 0x00_00_00, format: "png" }
    ]);
  });

  it("serves every capture of one frame with one extract", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const mock = await started();
    const first = mock.api.capture();
    const second = mock.api.capture();

    frame(mock, 0, 2);

    await expect(first).resolves.toBe(FAKE_PNG);
    await expect(second).resolves.toBe(FAKE_PNG);
    expect(mock.pixi.last().renderer.extract.calls).toHaveLength(1);
  });

  it("takes the picture at once while the clock is paused, since no frame will come", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const mock = await started();

    mock.setPaused(true);

    await expect(mock.api.capture()).resolves.toBe(FAKE_PNG);
  });

  it("logs a failed read and answers undefined", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const mock = await started();

    mock.pixi.last().renderer.extract.base64 = () => Promise.reject(new Error("gpu busy"));
    mock.setPaused(true);

    await expect(mock.api.capture()).resolves.toBeUndefined();
    expect(mock.log.error).toHaveBeenCalledWith("renderer: capture failed", {
      error: expect.any(Error)
    });
  });

  it("answers undefined to a capture still waiting when the renderer stops", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const mock = await started();
    const waiting = mock.api.capture();

    mock.stop();

    await expect(waiting).resolves.toBeUndefined();
    expect(mock.ctx.state.monitor.captures).toHaveLength(0);
  });
});
