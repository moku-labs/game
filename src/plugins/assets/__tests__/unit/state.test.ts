import { describe, expect, it } from "vitest";
import { createAssetsState } from "../../state";

describe("createAssetsState", () => {
  it("starts headless with an empty manifest", () => {
    const state = createAssetsState();

    expect(state.io).toBeUndefined();
    expect(state.manifest).toEqual({ version: 1, bundles: {} });
    expect(state.current).toBeUndefined();
    expect(state.sceneBundle).toBeUndefined();
    expect(state.queue).toBeUndefined();
    expect(state.useCounter).toBe(0);
  });

  it("starts with empty registries", () => {
    const state = createAssetsState();

    expect(state.bundleOfKey.size).toBe(0);
    expect(state.bundleOfScene.size).toBe(0);
    expect(state.featureOfFlow.size).toBe(0);
    expect(state.records.size).toBe(0);
    expect(state.pinned.size).toBe(0);
    expect(state.warned.size).toBe(0);
    expect(state.removers).toEqual([]);
  });

  it("gives every call its own collections", () => {
    const first = createAssetsState();
    const second = createAssetsState();

    first.records.set("board", {
      status: "idle",
      textures: new Map(),
      fonts: new Map(),
      audio: new Map(),
      inflight: undefined,
      lastUsed: 0
    });

    expect(second.records.size).toBe(0);
  });
});
