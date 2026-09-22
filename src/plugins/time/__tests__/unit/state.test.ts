import { describe, expect, it } from "vitest";
import { PHASES } from "../../api";
import { createTimeState } from "../../state";
import type { Config } from "../../types";

const config: Config = { maxFps: 60, maxDeltaMs: 50, idleFps: 30, idleAfterMs: 2000 };
const global = { orientation: "portrait", referenceSide: 1080 };

// ─── createTimeState ──────────────────────────────────────────

describe("createTimeState", () => {
  it("creates one empty callback list per phase, in phase order", () => {
    const state = createTimeState({ global, config });

    expect(Object.keys(state.callbacks)).toEqual([...PHASES]);
    expect(Object.values(state.callbacks)).toEqual([[], [], [], [], [], []]);
  });

  it("starts with a zeroed Time at scale 1", () => {
    const state = createTimeState({ global, config });

    expect(state.time).toEqual({ delta: 0, elapsed: 0, scale: 1, frame: 0, idle: false });
  });

  it("starts not paused, not running, not stepping and without a frame handle", () => {
    const state = createTimeState({ global, config });

    expect(state.paused).toBe(false);
    expect(state.running).toBe(false);
    expect(state.stepping).toBe(false);
    expect(state.rafId).toBeUndefined();
    expect(state.lastTimestamp).toBeUndefined();
  });

  it("starts awake, with an empty unscaled clock and no wake behind it", () => {
    const state = createTimeState({ global, config });

    expect(state.idle).toBe(false);
    expect(state.unscaledElapsedMs).toBe(0);
    expect(state.lastWakeMs).toBe(0);
  });

  it("gives every app its own callback lists", () => {
    const first = createTimeState({ global, config });
    const second = createTimeState({ global, config });

    first.callbacks.animate.push(() => {});

    expect(second.callbacks.animate).toEqual([]);
  });
});

// ─── PHASES ───────────────────────────────────────────────────

describe("PHASES", () => {
  it("lists the six phases in the fixed call order", () => {
    expect([...PHASES]).toEqual(["input", "animate", "layout", "sync", "signals", "render"]);
  });
});
