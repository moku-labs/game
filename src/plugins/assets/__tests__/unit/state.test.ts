import { describe, expect, it } from "vitest";
import { releaseAll } from "../../lifecycle";
import { createAssetsState } from "../../state";

describe("createAssetsState", () => {
  it("starts headless with an empty manifest", () => {
    const state = createAssetsState();

    expect(state.io).toBeUndefined();
    expect(state.manifest).toEqual({ version: 1, bundles: {} });
    expect(state.current).toBeUndefined();
    expect(state.sceneId).toBeUndefined();
    expect(state.queue).toBeUndefined();
    expect(state.useCounter).toBe(0);
  });

  it("starts with no stamp applied and no hot swap running", () => {
    const state = createAssetsState();

    expect(state.stamps).toBeUndefined();
    expect(state.swapping).toBeUndefined();
  });

  it("starts with empty registries", () => {
    const state = createAssetsState();

    expect(state.bundleOfKey.size).toBe(0);
    expect(state.scenes.size).toBe(0);
    expect(state.featureOfFlow.size).toBe(0);
    expect(state.records.size).toBe(0);
    expect(state.pinned.size).toBe(0);
    expect(state.warned.size).toBe(0);
    expect(state.removers).toEqual([]);
  });

  // Bug: a loop-guard mark of the last session survives into the next one, or the key lists of a manifest stay.
  it("starts the budget's key lists and loop guard empty, and releaseAll empties them", () => {
    const state = createAssetsState();

    expect(state.keysOf.size).toBe(0);
    expect(state.budgetUnloaded.size).toBe(0);
    expect(state.reloadHeld.size).toBe(0);
    expect(state.thrashWarned.size).toBe(0);

    state.keysOf.set("board", ["board.cell"]);
    state.budgetUnloaded.add("board");
    state.reloadHeld.add("board");
    state.thrashWarned.add("board");
    releaseAll(state);

    expect(state.keysOf.size).toBe(0);
    expect(state.budgetUnloaded.size).toBe(0);
    expect(state.reloadHeld.size).toBe(0);
    expect(state.thrashWarned.size).toBe(0);
  });

  it("gives every call its own collections", () => {
    const first = createAssetsState();
    const second = createAssetsState();

    first.records.set("board", {
      status: "idle",
      textures: new Map(),
      fonts: new Map(),
      audio: new Map(),
      pages: new Map(),
      inflight: undefined,
      lastUsed: 0
    });

    expect(second.records.size).toBe(0);
  });
});
