import { describe, expect, it } from "vitest";
import { createAnimState } from "../../state";

const ctx = { global: {}, config: { maxTracks: 2000 } };

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
