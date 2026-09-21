import { afterEach, describe, expect, it, vi } from "vitest";
import { stopLoop } from "../../lifecycle";
import { createTimeState } from "../../state";
import type { Config } from "../../types";

const config: Config = { maxFps: 60, maxDeltaMs: 50 };
const global = { orientation: "portrait", referenceSide: 1080 };

// ─── stopLoop, the onStop of the plugin ───────────────────────

describe("stopLoop", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("cancels the pending frame and forgets the frame source", () => {
    const cancel = vi.fn();
    const state = createTimeState({ global, config });

    vi.stubGlobal("cancelAnimationFrame", cancel);
    state.rafId = 7;
    state.lastTimestamp = 1234;
    state.running = true;
    stopLoop(state);

    expect(cancel).toHaveBeenCalledWith(7);
    expect(state.rafId).toBeUndefined();
    expect(state.lastTimestamp).toBeUndefined();
    expect(state.running).toBe(false);
  });

  it("cancels nothing when the loop never started, as in plain Bun", () => {
    const cancel = vi.fn();
    const state = createTimeState({ global, config });

    vi.stubGlobal("cancelAnimationFrame", cancel);
    stopLoop(state);

    expect(cancel).not.toHaveBeenCalled();
    expect(state.running).toBe(false);
  });
});
