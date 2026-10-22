import { describe, expect, it } from "vitest";
import { createRendererState } from "../../state";
import type { Config } from "../../types";

const config: Config = {
  mount: undefined,
  background: 0x00_00_00,
  antialias: false,
  maxResolution: 2,
  poolTrim: { restMs: 1000, aboveMb: 16 },
  preference: "webgpu",
  aspect: { min: 4 / 3, max: 21 / 9 },
  poolLimit: 256,
  unsupportedMessage: "This device cannot run the game.",
  loadPixi: () => Promise.reject(new Error("not loaded in this test")),
  debug: { nineSlice: false, verifyFrames: false },
  monitor: { budgetMs: "rate", frames: 1024 },
  onDemand: false,
  keptMb: 64,
  warm: 1,
  uploads: 1,
  adaptiveScale: { floor: 0.75, devices: "phone" }
};

describe("renderer state", () => {
  it("starts with one empty branch per module", () => {
    const state = createRendererState({ config });

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
      unsupported: undefined,
      uninstallCounting: undefined,
      resolution: { dpr: 1, cap: 2, override: undefined, pending: undefined, scale: 1, floor: 1 },
      onResolutionChange: [],
      ownGpu: undefined,
      kept: new WeakSet(),
      pixelsFailed: false,
      pool: { lastDrawnAt: undefined, sceneAt: undefined, restDone: false, baseline: 0 },
      onTrim: []
    });
    expect(state.viewport.scale).toBe(1);
    expect(state.viewport.frame).toEqual({ x: 0, y: 0, width: 0, height: 0 });
    expect(state.viewport.safeArea).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
    expect(state.sync.root).toBeUndefined();
    expect(state.sync.layerList).toBeUndefined();
    expect(state.sync.pooled).toBe(0);
    expect(state.sync.filters.size).toBe(0);
    expect(state.sync.slices).toBeInstanceOf(WeakSet);
    expect(state.monitor.draws).toEqual({ frame: 0, last: 0 });
  });

  it("gives every app its own collections", () => {
    const first = createRendererState({ config });
    const second = createRendererState({ config });

    first.sync.views.set(1, {
      object: {} as never,
      kind: "Sprite",
      poolKey: "Sprite:x",
      layer: "items",
      textureKey: "x",
      wrapper: undefined,
      placeholder: false,
      mask: undefined,
      clipped: undefined,
      display: undefined,
      value: undefined,
      drawScale: { x: 1, y: 1 },
      frameKey: "",
      outline: undefined,
      hitBox: { x: 0, y: 0, width: 1, height: 1 },
      drawn: undefined,
      clipDrawn: undefined,
      hiddenSelf: 0,
      hiddenTop: 0,
      hud: 1
    });

    expect(second.sync.views.size).toBe(0);
    expect(second.sync.layers).not.toBe(first.sync.layers);
    expect(second.host.cleanups).not.toBe(first.host.cleanups);
    expect(second.sync.filters).not.toBe(first.sync.filters);
    expect(second.sync.slices).not.toBe(first.sync.slices);
    expect(second.monitor.draws).not.toBe(first.monitor.draws);
    expect(second.host.pool).not.toBe(first.host.pool);
    expect(second.host.onTrim).not.toBe(first.host.onTrim);
  });
});

describe("renderer state: the pool trim of the config", () => {
  it("refuses a poolTrim that is neither false nor an object", () => {
    // eslint-disable-next-line unicorn/no-null -- a config can hold null: it is refused like any other non-object.
    for (const poolTrim of [true, null, 1000]) {
      expect(() =>
        createRendererState({ config: { ...config, poolTrim: poolTrim as never } })
      ).toThrow(
        `[game] renderer.poolTrim is ${String(poolTrim)}.\n  Give { restMs, aboveMb } or false.`
      );
    }
  });

  it("refuses a restMs that is not a finite number of at least 0, and one left out", () => {
    const trims = [-1, Number.NaN, Number.POSITIVE_INFINITY, "1000"].map(restMs => ({
      restMs,
      aboveMb: 16
    }));

    // A shallow merge replaces the whole default: `{ aboveMb: 32 }` alone has no restMs.
    for (const poolTrim of [...trims, { aboveMb: 32 }]) {
      expect(() =>
        createRendererState({ config: { ...config, poolTrim: poolTrim as never } })
      ).toThrow(
        `[game] renderer.poolTrim.restMs is ${String((poolTrim as { restMs?: unknown }).restMs)}.\n` +
          "  Give the clock milliseconds of a still screen, 0 or more."
      );
    }
  });

  it("refuses an aboveMb that is not a finite number of at least 0, and one left out", () => {
    const trims = [-0.5, Number.NaN].map(aboveMb => ({ restMs: 1000, aboveMb }));

    for (const poolTrim of [...trims, { restMs: 500 }]) {
      expect(() =>
        createRendererState({ config: { ...config, poolTrim: poolTrim as never } })
      ).toThrow(
        `[game] renderer.poolTrim.aboveMb is ${String((poolTrim as { aboveMb?: unknown }).aboveMb)}.\n` +
          "  Give the MiB the targets must grow by, 0 or more."
      );
    }
  });

  it("takes false, and 0 for both numbers", () => {
    expect(() => createRendererState({ config: { ...config, poolTrim: false } })).not.toThrow();
    expect(() =>
      createRendererState({ config: { ...config, poolTrim: { restMs: 0, aboveMb: 0 } } })
    ).not.toThrow();
  });
});

describe("renderer state: the probe draws of the warm-up", () => {
  // Bug: a fraction or a huge count reaches the frame loop: 2.5 draws a frame, or 1000 renders in one frame.
  it("refuses a warm that is not a whole number from 0 to 16, and takes 0 and 16", () => {
    for (const warm of [-1, 2.5, 17, Number.NaN, "1"]) {
      expect(() => createRendererState({ config: { ...config, warm: warm as never } })).toThrow(
        `[game] renderer.warm is ${String(warm)}.\n  Give the probe draws per frame, a whole number from 0 to 16.`
      );
    }

    expect(() => createRendererState({ config: { ...config, warm: 0 } })).not.toThrow();
    expect(() => createRendererState({ config: { ...config, warm: 16 } })).not.toThrow();
  });
});

describe("renderer state: the textures uploaded per drawn frame", () => {
  // Bug: a fraction or a huge count reaches the upload step: 1.5 uploads a frame, or 40 uploads of ~9 ms in one frame.
  it("refuses an uploads that is not a whole number from 0 to 8, and takes 0 and 8", () => {
    for (const uploads of [-1, 1.5, 9, Number.NaN, "1"]) {
      expect(() =>
        createRendererState({ config: { ...config, uploads: uploads as never } })
      ).toThrow(
        `[game] renderer.uploads is ${String(uploads)}.\n  Give the textures uploaded per drawn frame, a whole number from 0 to 8.`
      );
    }

    expect(() => createRendererState({ config: { ...config, uploads: 0 } })).not.toThrow();
    expect(() => createRendererState({ config: { ...config, uploads: 8 } })).not.toThrow();
  });
});

describe("renderer state: the adaptive render scale", () => {
  // Bug: a floor of 0.1 draws a blur on a phone; a typo in devices turns the scale off without a word.
  it("refuses a floor that is not a step of the scale and devices other than phone or all; takes false", () => {
    for (const floor of [0.4, 0.7, 1.2, Number.NaN, "0.75"]) {
      expect(() =>
        createRendererState({
          config: { ...config, adaptiveScale: { floor, devices: "phone" } as never }
        })
      ).toThrow(
        `[game] renderer.adaptiveScale.floor is ${String(floor)}.\n  Give a step of the scale: 1, 0.85, 0.75, 0.6 or 0.5.`
      );
    }

    expect(() =>
      createRendererState({
        config: { ...config, adaptiveScale: { floor: 0.75, devices: "tablet" } as never }
      })
    ).toThrow('[game] renderer.adaptiveScale.devices is tablet.\n  Give "phone" or "all".');
    expect(() =>
      createRendererState({ config: { ...config, adaptiveScale: true as never } })
    ).toThrow("[game] renderer.adaptiveScale is true.\n  Give { floor, devices } or false.");
    expect(() =>
      createRendererState({ config: { ...config, adaptiveScale: false } })
    ).not.toThrow();
    expect(() =>
      createRendererState({ config: { ...config, adaptiveScale: { floor: 0.5, devices: "all" } } })
    ).not.toThrow();
  });
});
