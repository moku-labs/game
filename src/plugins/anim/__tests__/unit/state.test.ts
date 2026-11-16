import { describe, expect, it } from "vitest";
import { createAnimState } from "../../state";

const ctx = { config: { maxTracks: 2000, reducedMotion: false } };

describe("createAnimState", () => {
  it("starts with an empty track table, no timeline, no animation and no listener", () => {
    const state = createAnimState(ctx);

    expect(state.tracks.size).toBe(0);
    expect(state.owner.size).toBe(0);
    expect(state.offsets.size).toBe(0);
    expect(state.bases.size).toBe(0);
    expect(state.timelines.size).toBe(0);
    expect(state.registry.size).toBe(0);
    expect(state.markListeners.size).toBe(0);
    expect(state.nextId).toBe(1);
    expect(state.frame).toBe(0);
    expect(state.overMaxTracks).toBe(false);
  });

  it("starts the ring of ended timelines with 16 blank records that no other app shares", () => {
    const first = createAnimState(ctx);
    const second = createAnimState(ctx);

    expect(first.endedNext).toBe(0);
    expect(first.endedCount).toBe(0);
    expect(first.ended).toHaveLength(16);
    expect(first.ended[0]).toEqual({
      timeline: 0,
      animation: "",
      startFrame: 0,
      endFrame: 0,
      reason: "ended"
    });
    expect(new Set(first.ended).size).toBe(16);
    expect(second.ended[0]).not.toBe(first.ended[0]);
  });

  it("holds no remover before onInit and onStart ran", () => {
    const state = createAnimState(ctx);

    expect(state.removeDriver).toBeUndefined();
    expect(state.offFrame).toBeUndefined();
    expect(state.offPlay).toBeUndefined();
    expect(state.finishAll).toBeUndefined();
  });

  it("gives every app its own tables", () => {
    const first = createAnimState(ctx);
    const second = createAnimState(ctx);

    first.registry.set("a", {
      id: "a",
      slots: {},
      build: () => ({ kind: "wait", ms: 0 })
    } as never);

    expect(second.registry.size).toBe(0);
  });
});
