import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, createPlugin, timePlugin } from "../../../../index";
import type { FrameRate, RateChange } from "../../types";

// ---------------------------------------------------------------------------
// Integration: the adaptive frame rate in a real app with `time` and
// `lifecycle` (spec 21 "Integration"). A stubbed `requestAnimationFrame` queue
// is fired with vsync timestamps of a 120 Hz panel; a `render` callback stands
// for the renderer: it spends 1 ms and reports the frame drawn.
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** The frame source and the page clock of one test. */
type Device = {
  /** The page clock now. */
  now(): number;
  /** Fires the pending frame at `at`. */
  fire(at: number): void;
};

/**
 * Stubs the frame source and the page clock.
 *
 * @returns The device.
 */
function stubDevice(): Device {
  const clock = { now: 0 };
  let pending: FrameRequestCallback | undefined;

  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    pending = callback;

    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.spyOn(globalThis.performance, "now").mockImplementation(() => clock.now);

  return {
    now: () => clock.now,
    fire: at => {
      const callback = pending;

      pending = undefined;
      clock.now = at;
      callback?.(at);
    }
  };
}

/** The time config of a game that adapts between 120 and 60, without the idle cap. */
const adaptive = { maxFps: 120, idleFps: 0, adaptive: { floor: 60 } } as const;

/**
 * Starts an app that adapts between 120 and 60, with a renderer stand-in.
 *
 * @returns The started app.
 */
async function startApp() {
  const app = createApp({ pluginConfigs: { time: adaptive } });

  await app.start();
  app.time.onFrame("render", () => app.time.frameDrawn());

  return app;
}

describe("the adaptive frame rate in an app", () => {
  it("a 120 Hz device that cannot hold 120 settles at 60, stays there for the dwell, then probes once", async () => {
    const device = stubDevice();
    const app = await startApp();
    const switches: Array<{ at: number; rate: Readonly<FrameRate> }> = [];
    let at = 0;
    let seen = app.time.rate();

    /**
     * Plays the panel for `ms`. On the heavy screen the GPU cannot hold 120: at that rate the frames come every
     * 16.7 ms; at 60 every vsync ticks and every other one runs.
     *
     * @param ms - How long.
     * @param heavy - The heavy screen.
     */
    const play = (ms: number, heavy: boolean): void => {
      const end = at + ms;

      while (at < end) {
        at += heavy && app.time.rate().fps === 120 ? 1000 / 60 : 1000 / 120;
        device.fire(at);

        const now = app.time.rate();

        if (now.fps !== seen.fps || now.reason !== seen.reason) switches.push({ at, rate: now });

        seen = now;
      }
    };

    play(1500, false);
    play(12_000, true);
    await app.stop();

    expect(switches.map(({ rate }) => [rate.fps, rate.reason])).toEqual([
      [60, "missed"],
      [120, "headroom"],
      [60, "missed"]
    ]);

    const [drop, probe, again] = switches;

    expect(drop?.at).toBeLessThan(1500 + 300);
    expect((probe?.at ?? 0) - (drop?.at ?? 0)).toBeGreaterThanOrEqual(5000);
    expect((probe?.at ?? 0) - (drop?.at ?? 0)).toBeLessThan(5100);
    expect((again?.at ?? 0) - (probe?.at ?? 0)).toBeLessThan(300);
  });

  it("a pause in the background and a resume do not count the gap", async () => {
    const device = stubDevice();
    const app = await startApp();
    let at = 0;

    /**
     * Plays a light screen on the 120 Hz panel for `ms`.
     *
     * @param ms - How long.
     */
    const play = (ms: number): void => {
      for (const end = at + ms; at < end; ) {
        at += 1000 / 120;
        device.fire(at);
      }
    };

    play(1500);

    // Eight trips to the background of a tenth of a second each: no frame runs while paused.
    for (let trip = 0; trip < 8; trip += 1) {
      app.lifecycle.push("background");
      play(100);
      app.lifecycle.pop("background");
      play(30);
    }

    expect(app.time.rate()).toMatchObject({ fps: 120, reason: "start", displayHz: 120 });
    await app.stop();
  });

  it("a game hooking time:rate sees every switch in order with its reason", async () => {
    const device = stubDevice();
    const seen: RateChange[] = [];
    const rateLogPlugin = createPlugin("rateLog", {
      depends: [timePlugin],
      hooks: () => ({
        "time:rate": (change: RateChange) => {
          seen.push(change);
        }
      })
    });
    const app = createApp({ plugins: [rateLogPlugin], pluginConfigs: { time: adaptive } });

    await app.start();

    // A 60 Hz panel.
    for (let at = 1000 / 60; at < 2500; at += 1000 / 60) device.fire(at);

    app.time.setRate(30);
    app.time.setRate("auto");
    await app.stop();

    expect(seen.map(({ from, to, reason, mode }) => ({ from, to, reason, mode }))).toEqual([
      { from: 120, to: 60, reason: "display", mode: "auto" },
      { from: 60, to: 30, reason: "forced", mode: "forced" },
      { from: 30, to: 60, reason: "auto", mode: "auto" }
    ]);
    expect(device.now()).toBeGreaterThan(2000);
  });
});
