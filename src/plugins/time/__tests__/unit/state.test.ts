/* eslint-disable unicorn/no-null -- a frame rate is JSON: an unknown display and an absent shell are null. */
import { describe, expect, it } from "vitest";
import { PHASES } from "../../api";
import { createTimeState } from "../../state";
import type { Config } from "../../types";

const config: Config = {
  maxFps: 60,
  maxDeltaMs: 50,
  idleFps: 30,
  idleAfterMs: 2000,
  adaptive: false
};

// ─── createTimeState ──────────────────────────────────────────

describe("createTimeState", () => {
  it("creates one empty callback list per phase, in phase order", () => {
    const state = createTimeState({ config });

    expect(Object.keys(state.callbacks)).toEqual([...PHASES]);
    expect(Object.values(state.callbacks)).toEqual([[], [], [], [], [], []]);
  });

  it("starts with a zeroed Time at scale 1", () => {
    const state = createTimeState({ config });

    expect(state.time).toEqual({ delta: 0, elapsed: 0, scale: 1, frame: 0, idle: false });
  });

  it("starts not paused, not running, not stepping and without a frame handle", () => {
    const state = createTimeState({ config });

    expect(state.paused).toBe(false);
    expect(state.running).toBe(false);
    expect(state.stepping).toBe(false);
    expect(state.rafId).toBeUndefined();
    expect(state.lastTimestamp).toBeUndefined();
  });

  it("starts awake, with an empty unscaled clock and no wake behind it", () => {
    const state = createTimeState({ config });

    expect(state.idle).toBe(false);
    expect(state.unscaledElapsedMs).toBe(0);
    expect(state.lastWakeMs).toBe(0);
  });

  it("gives every app its own callback lists", () => {
    const first = createTimeState({ config });
    const second = createTimeState({ config });

    first.callbacks.animate.push(() => {});

    expect(second.callbacks.animate).toEqual([]);
  });
});

// ─── the adaptive config ──────────────────────────────────────

describe("createTimeState with adaptive", () => {
  it("refuses an adaptive that is not false or { floor: 30 | 60 }, naming the value", () => {
    expect(() =>
      createTimeState({ config: { ...config, adaptive: { floor: 45 } as unknown as false } })
    ).toThrow('[game] time.adaptive is {"floor":45}.\n  Give false, or { floor: 60 } (or 30).');
    expect(() =>
      createTimeState({ config: { ...config, adaptive: true as unknown as false } })
    ).toThrow("[game] time.adaptive is true.");
  });

  it("refuses a floor above maxFps", () => {
    expect(() =>
      createTimeState({ config: { ...config, maxFps: 30, adaptive: { floor: 60 } } })
    ).toThrow(
      "[game] time.adaptive.floor is 60, above time.maxFps 30.\n  Give a floor at or below maxFps."
    );
  });

  it("starts at maxFps in mode auto with a governor, and in mode fixed without one", () => {
    const adaptive = createTimeState({
      config: { ...config, maxFps: 120, adaptive: { floor: 60 } }
    });
    const fixed = createTimeState({ config });

    expect(adaptive.rate.snapshot).toEqual({
      fps: 120,
      mode: "auto",
      reason: "start",
      displayHz: null,
      ladder: [],
      thermal: null,
      asked: null,
      heldBy: null
    });
    expect(adaptive.rate.governor).toBeDefined();
    expect(fixed.rate.snapshot.mode).toBe("fixed");
    expect(fixed.rate.governor).toBeUndefined();
  });
});

// ─── PHASES ───────────────────────────────────────────────────

describe("PHASES", () => {
  it("lists the six phases in the fixed call order", () => {
    expect([...PHASES]).toEqual(["input", "animate", "layout", "sync", "signals", "render"]);
  });
});
