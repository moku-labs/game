import { describe, expect, it } from "vitest";
import {
  BLOOM_CUT_GLSL,
  BLOOM_CUT_WGSL,
  BloomCut,
  DOWNSAMPLE_GLSL,
  DOWNSAMPLE_WGSL,
  Downsample,
  GAUSS_ALONG_GLSL,
  GAUSS_ALONG_WGSL,
  GaussAlong,
  STAGE_GLSL,
  STAGE_WGSL
} from "../../../set/stages";
import { evaluate } from "./body-eval";
import { bodyCases, headsOf } from "./member-checks";

// ---------------------------------------------------------------------------
// Unit test: the stages of the set, which `Bloom`'s chain draws its `bright`
// texture with: `BloomCut`, `Downsample`, `GaussAlong`. Not root exports. Bun
// has no GPU: the pixels are the visual leg's; here their definitions, their
// bodies in both languages, and their numbers evaluated on the CPU.
// ---------------------------------------------------------------------------

/** Every stage with its two bodies and the uniforms they read. */
const STAGES = [
  { filter: BloomCut.filter, wgsl: BLOOM_CUT_WGSL, glsl: BLOOM_CUT_GLSL },
  { filter: Downsample.filter, wgsl: DOWNSAMPLE_WGSL, glsl: DOWNSAMPLE_GLSL },
  { filter: GaussAlong.filter, wgsl: GAUSS_ALONG_WGSL, glsl: GAUSS_ALONG_GLSL }
] as const;

/**
 * The `sampleInput(` calls of a body.
 *
 * @param body - A body, WGSL or GLSL.
 * @returns How many.
 */
function tapsIn(body: string): number {
  return [...body.matchAll(/\bsampleInput\(/g)].length;
}

/**
 * The first and the last `k` of a body's loop, in either language.
 *
 * @param body - The body.
 * @returns The two bounds, or `undefined` without a loop.
 */
function loopOf(body: string): [number, number] | undefined {
  const match = /for \((?:var|int) k = (-?\d+); k <= (-?\d+); k\+\+\)/.exec(body);

  return match === null ? undefined : [Number(match[1]), Number(match[2])];
}

/**
 * The stages' `inputTexel()` on one axis, read out of their helper and evaluated with Pixi's live uniforms.
 *
 * @param source - `STAGE_WGSL` or `STAGE_GLSL`.
 * @param frame - Texels of the input frame.
 * @param texture - Texels of the pooled texture it is a share of.
 * @returns One texel of the input, in the 0..1 of `inputPlace`.
 */
function texelOf(source: string, frame: number, texture: number): number {
  const expression = /inputTexel\(\)[^{]*\{\s*return ([^;]+);/.exec(source)?.[1];

  if (expression === undefined) throw new Error("no inputTexel in the stages' helper");

  // Pixi's live pass: `uInputPixel.zw` one over the texture's texels, the clamp half a texel in from the frame.
  const script = expression
    .replaceAll(/(?:gfu\.)?uInputPixel\.zw/g, String(1 / texture))
    .replaceAll(/(?:gfu\.)?uInputPixel\.xy/g, String(texture))
    .replaceAll(/(?:gfu\.)?uInputSize\.(?:xy|zw)/g, "NaN")
    .replaceAll(/(?:gfu\.)?uInputClamp\.zw/g, String(frame / texture - 0.5 / texture))
    .replaceAll(/(?:gfu\.)?uInputClamp\.xy/g, String(0.5 / texture));

  return new Function(`return ${script};`)() as number;
}

/**
 * `BloomCut`'s cut of a grey pixel, from its own WGSL: the three channels alike, premultiplied.
 *
 * @param grey - The straight grey, 0..1.
 * @param alpha - The pixel's alpha.
 * @param threshold - The threshold.
 * @returns The cut of each channel.
 */
function cut(grey: number, alpha: number, threshold: number): number {
  return evaluate(
    BLOOM_CUT_WGSL,
    { from: "cut", to: "cut" },
    { c: { rgb: grey * alpha, a: alpha }, threshold }
  );
}

/**
 * The alpha `BloomCut` gives a cut colour, from its own WGSL.
 *
 * @param r - The cut's red.
 * @param g - Its green.
 * @param b - Its blue.
 * @returns The alpha.
 */
function light(r: number, g: number, b: number): number {
  return evaluate(BLOOM_CUT_WGSL, { from: "light", to: "light" }, { cut: { r, g, b } });
}

describe.each(STAGES)("the stage $filter.id", stage => {
  bodyCases(stage);

  // Bug: a stage the engine refuses in a chain (an input or a fallback of its own), or one that reads the screen and
  // makes the bloom's picture "screen".
  it('has the plain signature once, draws alone and is "local"', () => {
    expect(headsOf(stage.wgsl)).toBe(1);
    expect(stage.filter.inputs).toEqual([]);
    expect(stage.filter.fallback).toBeUndefined();
    expect(stage.filter.backdrop).toBe(false);
    expect(stage.filter.cache).toBe("local");
  });

  // Bug: a stage that reads its input around the head: a read off the clamp, a neighbour's pixels in a pooled texture.
  it("reads its input through sampleInput only, as many times in both languages", () => {
    expect(stage.wgsl).not.toMatch(/\btextureSample(?:Level)?\s*\(/);
    expect(stage.glsl).not.toMatch(/\btexture(?:Lod)?\s*\(/);
    expect(tapsIn(stage.glsl)).toBe(tapsIn(stage.wgsl));
  });
});

describe("the stages' texel", () => {
  // Bug: the texel measured in CSS px or over the pooled texture: at resolution 2 every tap twice as far, or a
  // share of a large pooled texture squeezes the taps together.
  it.each([
    ["wgsl", STAGE_WGSL],
    ["glsl", STAGE_GLSL]
  ])("is one texel of the input frame in the 0..1 of inputPlace (%s)", (_language, source) => {
    expect(texelOf(source, 64, 64)).toBeCloseTo(1 / 63, 12);
    expect(texelOf(source, 64, 256)).toBeCloseTo(1 / 63, 12);
  });
});

describe("BloomCut", () => {
  // Bug: a bloom that lights the whole tile: the threshold is not taken off, or taken off the straight colour, so a
  // half-transparent edge blooms as an opaque one.
  it("keeps black at threshold 1 and, premultiplied, what is above the threshold", () => {
    for (const alpha of [0.25, 0.5, 1]) {
      for (const grey of [0, 0.5, 0.9, 1]) expect(cut(grey, alpha, 1)).toBe(0);
    }

    expect(cut(1, 1, 0.7)).toBeCloseTo(0.3, 12);
    expect(cut(1, 0.5, 0.7)).toBeCloseTo(0.15, 12);
    expect(cut(0.5, 1, 0.7)).toBe(0);
  });

  // Bug: the light keeps the view's alpha: where nothing is bright the bloom lays a dark halo around the shape.
  it("covers as much as its brightest channel", () => {
    expect(light(0.3, 0.1, 0)).toBeCloseTo(0.3, 12);
    expect(light(0, 0, 0)).toBe(0);
  });
});

describe("Downsample", () => {
  // Bug: a one-tap step: the bloom shimmers as the view moves under the coarse texels.
  it("takes 4 taps, a box", () => {
    expect(tapsIn(DOWNSAMPLE_WGSL)).toBe(4);
    expect(Downsample.filter.uniforms).toEqual([]);
  });
});

describe("GaussAlong", () => {
  // Bug: taps a texel apart (the bloom never widens) or `k × sigma` apart (±4 sigma: rings at sigma 8), or a GLSL
  // twin that takes another count of taps.
  it("takes 9 taps, k × sigma / 2 texels apart, so the last stands at 2 sigma at any sigma", () => {
    expect(loopOf(GAUSS_ALONG_WGSL)).toEqual([-4, 4]);
    expect(loopOf(GAUSS_ALONG_GLSL)).toEqual([-4, 4]);
    expect(tapsIn(GAUSS_ALONG_WGSL)).toBe(1);

    for (const sigma of [1, 5.25, 8]) {
      const reach = evaluate(GAUSS_ALONG_WGSL, { from: "reach", to: "reach" }, { sigma });

      expect(4 * reach).toBeCloseTo(2 * sigma, 12);
    }
  });

  // Bug: weights of another curve, or not normalised: the bloom brightens or darkens as sigma moves.
  it("weighs tap k by exp(-k² / 8), normalised by their sum", () => {
    const weights = [-4, -3, -2, -1, 0, 1, 2, 3, 4].map(k =>
      evaluate(GAUSS_ALONG_WGSL, { from: "w", to: "w" }, { k })
    );

    expect(weights).toEqual([-4, -3, -2, -1, 0, 1, 2, 3, 4].map(k => Math.exp((-k * k) / 8)));
    expect(GAUSS_ALONG_WGSL).toMatch(/total \+= w;[\s\S]*return sum \/ total;/);
  });
});
