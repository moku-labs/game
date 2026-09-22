import { describe, expect, it } from "vitest";
import { createAudioState } from "../../state";
import type { Config } from "../../types";

const config: Config = {
  buses: { master: 1, music: 0.6, sfx: 1 },
  musicFadeMs: 600,
  volumes: undefined,
  context: undefined
};

describe("createAudioState", () => {
  it("seeds every bus with the configured volume and no gain", () => {
    const state = createAudioState({ config });

    expect(state.buses.master).toEqual({ gain: undefined, volume: 1, muted: false });
    expect(state.buses.music).toEqual({ gain: undefined, volume: 0.6, muted: false });
    expect(state.buses.sfx).toEqual({ gain: undefined, volume: 1, muted: false });
  });

  it("starts headless, silent, unlocked-false and with nothing decoded", () => {
    const state = createAudioState({ config });

    expect(state.context).toBeUndefined();
    expect(state.paused).toBe(false);
    expect(state.unlocked).toBe(false);
    expect(state.music).toBeUndefined();
    expect(state.decoded.size).toBe(0);
    expect(state.warned.size).toBe(0);
    expect(state.removers).toEqual([]);
  });

  it("gives every app its own maps", () => {
    const first = createAudioState({ config });
    const second = createAudioState({ config });

    first.decoded.set("a", Promise.resolve({} as AudioBuffer));

    expect(second.decoded.size).toBe(0);
  });
});
