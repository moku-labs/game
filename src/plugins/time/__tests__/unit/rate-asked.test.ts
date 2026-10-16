/* eslint-disable unicorn/no-null -- a frame rate is JSON: an absent asked rate and a loop no panel holds are null. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createScript, type Script } from "./rate-script";

// ---------------------------------------------------------------------------
// Unit: the honest frame-rate pin (change 2026-10-16, U2). `rate()` tells the
// rate the loop is asked to hold (`asked`), the rate it really runs at (`fps`)
// and whether the panel holds it below the asked rate (`heldBy`). The frames
// the loop really runs are counted on the scripted frame source.
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * Counts the frames the loop runs in one second of the frame source.
 *
 * @param s - The script.
 * @returns The run frames.
 */
function framesInASecond(s: Script): number {
  const before = s.api.snapshot().frame;

  s.play(1000);

  return s.api.snapshot().frame - before;
}

describe("rate() of a fixed rate", () => {
  it("maxFps 120 without adaptive on a 60 Hz panel runs at 60, asked 120, held by the panel", () => {
    const s = createScript({ config: { adaptive: false }, displayHz: 60 });

    s.play(1000);

    expect(s.api.rate()).toEqual({
      fps: 60,
      mode: "fixed",
      reason: "start",
      displayHz: 60,
      ladder: [],
      thermal: null,
      asked: 120,
      heldBy: "panel"
    });
  });

  it.each([
    { maxFps: 120, hz: 60, fps: 60, heldBy: "panel" },
    { maxFps: 60, hz: 60, fps: 60, heldBy: null },
    { maxFps: 60, hz: 120, fps: 60, heldBy: null },
    { maxFps: 30, hz: 60, fps: 30, heldBy: null },
    { maxFps: 120, hz: 144, fps: 72, heldBy: null },
    { maxFps: 60, hz: 144, fps: 48, heldBy: null }
  ] as const)("maxFps $maxFps on a $hz Hz panel: fps $fps is the frames the loop runs, heldBy $heldBy", ({
    maxFps,
    hz,
    fps,
    heldBy
  }) => {
    const s = createScript({ config: { maxFps, adaptive: false }, displayHz: hz });

    s.play(1000);

    expect(s.api.rate()).toMatchObject({ fps, asked: maxFps, heldBy, displayHz: hz });
    expect(Math.abs(framesInASecond(s) - fps)).toBeLessThanOrEqual(1);
  });

  it("before the display is known, fps is the asked rate and no panel holds it", () => {
    const s = createScript({ config: { adaptive: false } });

    expect(s.api.rate()).toMatchObject({ fps: 120, asked: 120, heldBy: null, displayHz: null });
  });
});

describe("rate() of a forced rate", () => {
  it("a pin of 120 on a 60 Hz panel runs at 60, asked 120, held by the panel", () => {
    const s = createScript({ displayHz: 60 });

    s.play(2500);

    expect(s.api.setRate(120)).toMatchObject({
      fps: 60,
      mode: "forced",
      asked: 120,
      heldBy: "panel"
    });
    expect(Math.abs(framesInASecond(s) - 60)).toBeLessThanOrEqual(1);
  });

  it("a pin of 60 on a 120 Hz panel runs at 60, asked 60, no panel holds it", () => {
    const s = createScript();

    s.play(2000);

    expect(s.api.setRate(60)).toMatchObject({
      fps: 60,
      mode: "forced",
      asked: 60,
      heldBy: null
    });
  });

  it("a pin above maxFps asks maxFps, the cap the loop is told", () => {
    const s = createScript({ config: { maxFps: 60, adaptive: false }, displayHz: 120 });

    s.play(1000);

    expect(s.api.setRate(120)).toMatchObject({ fps: 60, mode: "forced", asked: 60, heldBy: null });
  });
});

describe("rate() of the adaptive rule", () => {
  it("asks nothing in mode auto, also after a pin is given back", () => {
    const s = createScript();

    s.play(2000);

    expect(s.api.rate()).toMatchObject({ fps: 120, mode: "auto", asked: null, heldBy: null });

    s.api.setRate(60);

    expect(s.api.setRate("auto")).toMatchObject({ mode: "auto", asked: null, heldBy: null });
  });
});
