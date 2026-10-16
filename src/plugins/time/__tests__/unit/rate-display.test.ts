/* eslint-disable unicorn/no-null -- a frame rate is JSON: an unknown display and the shell's missing maxHz are null. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createScript } from "./rate-script";

// ---------------------------------------------------------------------------
// Unit: the display rate of the adaptive frame rate (spec 21 G4): learned from
// the ticks of the frame source, the ticks the cap skips included; lowered only
// after two windows, never from a panel held low by our own request; a rising
// display never raises the rate by itself.
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("the display rate from the ticks", () => {
  it("a 60 Hz display runs a maxFps 120 game at 60 with reason display", () => {
    const s = createScript({ displayHz: 60 });

    s.play(2500);

    expect(s.changes()).toEqual([
      expect.objectContaining({ from: 120, to: 60, reason: "display", mode: "auto", displayHz: 60 })
    ]);
    expect(s.api.rate()).toMatchObject({ fps: 60, displayHz: 60, ladder: [60] });
  });

  it("a 144 Hz display runs at 72", () => {
    const s = createScript({ displayHz: 144 });

    s.play(2000);

    expect(s.api.rate()).toMatchObject({
      fps: 72,
      reason: "display",
      displayHz: 144,
      ladder: [72]
    });
  });

  it("no decision before the display is known: 0.9 s of late frames at boot drop nothing", () => {
    const s = createScript();

    s.gaps(17, 53);

    expect(s.api.rate()).toMatchObject({ fps: 120, displayHz: null });
    expect(s.changes()).toEqual([]);
  });

  it("ticks skipped by the 60 cap keep a 120 Hz display known", () => {
    const s = createScript();

    s.play(2000);
    s.api.setRate(60);
    s.play(5000);

    expect(s.api.rate()).toMatchObject({ fps: 60, displayHz: 120, ladder: [120, 60] });
  });

  it("two windows of 16.7 ms ticks at the top rate lower the display, one window does not", () => {
    const s = createScript();

    s.play(2000);
    // Battery saver: the panel goes to 60 Hz by itself.
    s.setDisplay(60);
    s.play(2100);

    expect(s.api.rate().displayHz).toBe(120);

    s.play(2000);

    expect(s.api.rate()).toMatchObject({ fps: 60, displayHz: 60, ladder: [60] });
  });

  it("a rising display rate never raises the rate by itself", () => {
    const s = createScript({ displayHz: 60 });

    s.play(2100);
    s.setDisplay(120);
    s.play(1100);

    expect(s.api.rate()).toMatchObject({ fps: 60, displayHz: 120, ladder: [120, 60] });
    expect(s.changes()).toHaveLength(1);
  });
});

describe("the display rate without adaptive", () => {
  it("a 60 Hz display is known within 32 ticks of a maxFps 120 game, then a window is 120 ticks", () => {
    const s = createScript({ config: { adaptive: false }, displayHz: 60 });

    s.play(32 * (1000 / 60));

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
    expect(s.changes()).toEqual([]);

    // The panel goes to 120 Hz: half a second of its ticks is not a whole window yet.
    s.setDisplay(120);
    s.play(500);

    expect(s.api.rate().displayHz).toBe(60);

    s.play(600);

    expect(s.api.rate().displayHz).toBe(120);
  });
});

describe("the display rate on the native shell", () => {
  it("16.7 ms ticks of a panel the shell holds at 60 on our request never lower the display", async () => {
    const setFrameRate = vi.fn(() => ({ panelHz: 60, maxHz: null }));

    vi.stubGlobal("__MOKU_NATIVE__", { version: 1, display: { setFrameRate, maxHz: null } });
    const s = createScript();

    s.start();
    s.play(2000);
    s.untilRate(60, 17);
    await Promise.resolve();
    // The panel follows our request of 60: two windows of 16.7 ms ticks, before the dwell ends.
    s.setDisplay(60);
    s.play(4500);

    expect(setFrameRate.mock.calls).toEqual([[120], [60]]);
    expect(s.api.rate()).toMatchObject({ fps: 60, displayHz: 120, ladder: [120, 60] });
    s.stop();
  });
});
