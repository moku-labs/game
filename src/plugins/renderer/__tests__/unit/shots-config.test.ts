import { describe, expect, it } from "vitest";
import type { ShotsConfig } from "../../shots/types";
import { createRendererState } from "../../state";
import type { Config } from "../../types";

// ---------------------------------------------------------------------------
// Unit: the checks of `renderer.shots` at `createApp`. A bad value is a clear error at the start, not a GPU validation
// error in the frame of the first take.
// ---------------------------------------------------------------------------

const base: Config = {
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
  adaptiveScale: { floor: 0.75, devices: "phone" },
  shots: undefined
};

/** A valid config, a field at a time replaced below. */
const fine: ShotsConfig = { width: 96, height: 208, blur: 22 };

/**
 * Creates the state over a `shots` value.
 *
 * @param shots - What the config holds, right or wrong.
 * @returns The state.
 */
function stateWith(shots: unknown): ReturnType<typeof createRendererState> {
  return createRendererState({ config: { ...base, shots: shots as ShotsConfig } });
}

describe("the checks of renderer.shots", () => {
  // Bug: a game with no shots is refused, or a size at the limit is.
  it("takes no shots, and the sizes and values at their limits", () => {
    expect(() => stateWith(undefined)).not.toThrow();
    expect(() => stateWith({ width: 1, height: 512, blur: 0 })).not.toThrow();
    expect(() => stateWith({ ...fine, keep: 1 })).not.toThrow();
  });

  // Bug: a hand-written config in plain JS reaches the first take as a string or a null.
  it("refuses what is no object", () => {
    expect(() => stateWith(96)).toThrow(/\[game\] renderer\.shots is 96\./);
    // eslint-disable-next-line unicorn/no-null -- a plain JS config can hold it
    expect(() => stateWith(null)).toThrow(/\[game\] renderer\.shots is null\./);
  });

  // Bug: a size outside 1 to 512, or a fraction, makes a texture the GPU refuses in the frame of the first take.
  it.each(["width", "height"] as const)("refuses a %s outside 1 to 512", field => {
    for (const value of [0, 513, 1.5, Number.NaN, "96"]) {
      expect(() => stateWith({ ...fine, [field]: value })).toThrow(
        new RegExp(String.raw`\[game\] renderer\.shots\.${field} is ${String(value)}\.`)
      );
    }
  });

  // Bug: a negative or endless blur turns into a sigma with no kernel.
  it("refuses a blur that is not finite and 0 or more", () => {
    for (const value of [-1, Number.POSITIVE_INFINITY, Number.NaN, "22"]) {
      expect(() => stateWith({ ...fine, blur: value })).toThrow(
        new RegExp(String.raw`\[game\] renderer\.shots\.blur is ${String(value)}\.`)
      );
    }
  });

  // Bug: a keep of 0 evicts every shot it takes, and a fraction keeps the count off by one.
  it("refuses a keep that is not a whole number of at least 1", () => {
    for (const value of [0, -1, 1.5, Number.NaN]) {
      expect(() => stateWith({ ...fine, keep: value })).toThrow(
        new RegExp(String.raw`\[game\] renderer\.shots\.keep is ${String(value)}\.`)
      );
    }
  });
});
