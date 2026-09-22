import { describe, expect, it } from "vitest";
import { applyGain, buildGraph, effectiveGain } from "../../graph";
import { createAudioState } from "../../state";
import type { Bus, BusState, Config, State } from "../../types";
import { createFakeContext, type FakeContext } from "../fake-audio-context";

const config: Config = {
  buses: { master: 1, music: 0.6, sfx: 1 },
  musicFadeMs: 600,
  volumes: undefined,
  context: undefined
};

/** A state with a live graph on the fake context. */
function wired(): { state: State; context: FakeContext } {
  const context = createFakeContext();
  const state = createAudioState({ config });

  state.context = context;
  state.buses = buildGraph(context, state.buses);

  return { state, context };
}

describe("buildGraph", () => {
  it("wires master into the destination and music and sfx into master", () => {
    const { context } = wired();

    expect(context.gains).toHaveLength(3);
    expect(context.gains[0]?.connectedTo).toBe(context.destination);
    expect(context.gains[1]?.connectedTo).toBe(context.gains[0]);
    expect(context.gains[2]?.connectedTo).toBe(context.gains[0]);
  });

  it("keeps the volume and the mute of every bus it was given", () => {
    const { state } = wired();

    expect(state.buses.music.volume).toBe(0.6);
    expect(state.buses.music.muted).toBe(false);
    expect(state.buses.master.gain).toBeDefined();
  });
});

/** One bus entry at half volume, with whatever a test overrides. */
function entry(over: Partial<BusState> = {}): BusState {
  return { gain: undefined, volume: 0.5, muted: false, ...over };
}

describe("effectiveGain", () => {
  it("is the volume while the bus plays", () => {
    expect(effectiveGain(entry(), false)).toBe(0.5);
  });

  it("is zero while the bus is muted", () => {
    expect(effectiveGain(entry({ muted: true }), false)).toBe(0);
  });

  it("is zero while the game is paused", () => {
    expect(effectiveGain(entry(), true)).toBe(0);
  });

  it("is zero when both hold", () => {
    expect(effectiveGain(entry({ muted: true }), true)).toBe(0);
  });
});

describe("applyGain", () => {
  it("schedules the current value now and ramps to the target", () => {
    const { state, context } = wired();

    context.currentTime = 4;
    applyGain(state, "music");

    expect(context.gains[1]?.gain.sets).toEqual([[1, 4]]);
    expect(context.gains[1]?.gain.ramps).toEqual([[0.6, 4]]);
  });

  it("ramps over the seconds it was given", () => {
    const { state, context } = wired();

    context.currentTime = 2;
    applyGain(state, "sfx", 0.6);

    expect(context.gains[2]?.gain.ramps).toEqual([[1, 2.6]]);
  });

  it("schedules zero for a muted bus and the volume again when it is unmuted", () => {
    const { state, context } = wired();

    state.buses.master.muted = true;
    applyGain(state, "master");
    state.buses.master.muted = false;
    applyGain(state, "master");

    expect(context.gains[0]?.gain.ramps).toEqual([
      [0, 0],
      [1, 0]
    ]);
  });

  it("does nothing headless", () => {
    const state = createAudioState({ config });
    const bus: Bus = "music";

    expect(() => applyGain(state, bus)).not.toThrow();
  });
});
