import { describe, expect, it } from "vitest";
import { createRendererState } from "../../state";
import type { Config } from "../../types";

const config: Config = {
  mount: undefined,
  background: 0x00_00_00,
  antialias: false,
  maxResolution: 2,
  preference: "webgpu",
  aspect: { min: 4 / 3, max: 21 / 9 },
  poolLimit: 256,
  unsupportedMessage: "This device cannot run the game.",
  loadPixi: () => Promise.reject(new Error("not loaded in this test"))
};

describe("renderer state", () => {
  it("starts with one empty branch per module", () => {
    const state = createRendererState({ global: {}, config });

    expect(state.host).toEqual({
      pixi: undefined,
      app: undefined,
      canvas: undefined,
      mount: undefined,
      kind: "none",
      ready: false,
      restoring: false,
      onReady: [],
      onRestore: [],
      onLoss: [],
      cleanups: [],
      unsupported: undefined
    });
    expect(state.viewport.scale).toBe(1);
    expect(state.viewport.frame).toEqual({ x: 0, y: 0, width: 0, height: 0 });
    expect(state.viewport.safeArea).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
    expect(state.sync.root).toBeUndefined();
    expect(state.sync.layerList).toBeUndefined();
    expect(state.sync.pooled).toBe(0);
  });

  it("gives every app its own collections", () => {
    const first = createRendererState({ global: {}, config });
    const second = createRendererState({ global: {}, config });

    first.sync.views.set(1, {
      object: {} as never,
      kind: "Sprite",
      poolKey: "Sprite:x",
      layer: "items",
      textureKey: "x",
      wrapper: undefined,
      placeholder: false,
      hitBox: { x: 0, y: 0, width: 1, height: 1 }
    });

    expect(second.sync.views.size).toBe(0);
    expect(second.sync.layers).not.toBe(first.sync.layers);
    expect(second.host.cleanups).not.toBe(first.host.cleanups);
  });
});
