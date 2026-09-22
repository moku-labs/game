import { describe, expect, it } from "vitest";
import { createScenesState } from "../../state";

describe("createScenesState", () => {
  it("starts with no scene declared, none mounted and none pending", () => {
    const state = createScenesState();

    expect(state.scenes.size).toBe(0);
    expect(state.current).toBeUndefined();
    expect(state.pending).toBeUndefined();
    expect(state.teardown).toBeUndefined();
  });

  it("carries the one owner every mount of this plugin uses", () => {
    const state = createScenesState();

    expect(state.owner).toEqual({ kind: "plugin", name: "scenes" });
  });

  it("gives every app its own registry", () => {
    const first = createScenesState();
    const second = createScenesState();

    first.scenes.set("board", {
      id: "board",
      bundle: "board",
      music: undefined,
      layers: [],
      projections: []
    });

    expect(second.scenes.size).toBe(0);
  });
});
