import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../../../index";
import { worldPlugin } from "../../../world";
import { rendererPlugin } from "../../index";
import { installFakeDom } from "../fake-dom";
import { createFakePixi } from "../fake-pixi";

// ---------------------------------------------------------------------------
// Integration: the real time and renderer (change 2026-10-18-memory-render B2).
// A stubbed `requestAnimationFrame` is fired at the vsyncs of a 120 Hz phone
// whose GPU needs 20 ms for a frame at resolution 2; the pixels, and so the GPU
// time, go with the square of the resolution, and no vsync comes while the GPU
// still draws. A light second first teaches the panel's rate. The adaptive frame
// rate lowers the canvas resolution before the rate.
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** One vsync of the panel, ms. */
const VSYNC = 1000 / 120;

/** GPU ms of a frame at resolution 2 on the heavy screen; the first 1.5 s are light, so the panel is learned. */
const GPU_AT_2 = 20;

/** When the heavy screen starts, ms. */
const HEAVY_FROM = 1500;

/** Lets the renderer's lazy init settle. */
async function settle(): Promise<void> {
  for (let index = 0; index < 40; index += 1) await Promise.resolve();
}

describe("the adaptive render scale in an app", () => {
  it("a GPU-bound phone draws at 1.7, then 1.5, and only then drops to 60", async () => {
    installFakeDom({ width: 390, height: 844, dpr: 2.81 });

    const clock = { now: 0 };
    let pending: FrameRequestCallback | undefined;

    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      pending = callback;

      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.spyOn(globalThis.performance, "now").mockImplementation(() => clock.now);

    const pixi = createFakePixi();
    const app = createApp({
      plugins: [worldPlugin, rendererPlugin],
      pluginConfigs: {
        time: { maxFps: 120, idleFps: 0, adaptive: { floor: 60 } },
        renderer: {
          mount: "#game",
          loadPixi: () => Promise.resolve(pixi.module),
          warm: 0,
          adaptiveScale: { floor: 0.75, devices: "all" }
        }
      }
    });

    await app.start();
    await settle();

    const seen: Array<[number, number]> = [];
    let busyUntil = 0;

    for (let at = VSYNC; at < 6000; at += VSYNC) {
      // The GPU still draws the last frame: the browser hands out no frame.
      if (at < busyUntil - 1e-6) continue;

      const frame = app.time.snapshot().frame;
      const callback = pending;

      pending = undefined;
      clock.now = at;
      callback?.(at);

      if (app.time.snapshot().frame === frame) continue;

      const resolution = app.renderer.host.resolution();
      const { fps } = app.time.rate();
      const last = seen.at(-1);

      busyUntil = at + (at < HEAVY_FROM ? 2 : GPU_AT_2) * (resolution / 2) ** 2;
      if (last?.[0] !== fps || last[1] !== resolution) seen.push([fps, resolution]);
    }

    await app.stop();

    expect(seen).toEqual([
      [120, 2],
      [120, 1.7],
      [120, 1.5],
      [60, 1.5]
    ]);
  });
});
