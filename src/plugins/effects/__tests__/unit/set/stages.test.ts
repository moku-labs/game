import { describe, expect, it } from "vitest";
import {
  BLOOM_BLUR_GLSL,
  BLOOM_BLUR_WGSL,
  BLOOM_DOWN_GLSL,
  BLOOM_DOWN_WGSL,
  BloomBlur,
  BloomDown,
  STAGE_GLSL,
  STAGE_WGSL
} from "../../../set/stages";
import { evaluate, turnsOf, type Vec2 } from "./body-eval";
import { bodyCases, headsOf } from "./member-checks";

// ---------------------------------------------------------------------------
// Unit test: the stages of the set, which `Bloom`'s chain draws its `bright`
// texture with: `BloomDown`, `BloomBlur`. Not root exports. Bun has no GPU: the
// pixels are the visual leg's; here their definitions, their bodies in both
// languages, and their numbers evaluated on the CPU.
// ---------------------------------------------------------------------------

/** Every stage with its two bodies. */
const STAGES = [
  { filter: BloomDown.filter, wgsl: BLOOM_DOWN_WGSL, glsl: BLOOM_DOWN_GLSL },
  { filter: BloomBlur.filter, wgsl: BLOOM_BLUR_WGSL, glsl: BLOOM_BLUR_GLSL }
] as const;

/** The sigmas the chain asks the blur for at the defaults: 8 at the bench's 2, 5.25 at the phone's 2.625. */
const CHAIN_SIGMAS = [8, 5.25];

/**
 * The `sampleInput(` calls of a text.
 *
 * @param text - A body, WGSL or GLSL, or a part of it.
 * @returns How many.
 */
function tapsIn(text: string): number {
  return [...text.matchAll(/\bsampleInput\(/g)].length;
}

/**
 * How many turns a body's loop takes, in either language, and the calls of `sampleInput` inside it.
 *
 * @param body - The body.
 * @returns The turns and the taps of one turn, or `undefined` without a loop.
 */
function loopOf(body: string): { turns: number; taps: number } | undefined {
  const match = /for \((?:var|int) k = (\d+); k < (\d+); k\+\+\) \{([\s\S]*?)\n {2}\}/.exec(body);

  if (match === null) return undefined;

  return { turns: Number(match[2]) - Number(match[1]), taps: tapsIn(match[3] ?? "") };
}

/**
 * The samples a pixel of a body takes: the calls outside its loop, and the loop's calls once a turn.
 *
 * @param body - The body.
 * @returns How many.
 */
function samplesOf(body: string): number {
  const loop = loopOf(body) ?? { turns: 0, taps: 0 };

  return tapsIn(body) - loop.taps + loop.taps * loop.turns;
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
 * `BloomDown`'s cut of a grey pixel, from its own WGSL: the three channels alike, premultiplied.
 *
 * @param grey - The straight grey, 0..1.
 * @param alpha - The pixel's alpha.
 * @param threshold - The threshold.
 * @returns The cut of each channel.
 */
function cut(grey: number, alpha: number, threshold: number): number {
  return evaluate(
    BLOOM_DOWN_WGSL,
    { from: "cut", to: "cut" },
    { c: { rgb: grey * alpha, a: alpha }, threshold }
  );
}

/**
 * The alpha `BloomDown` gives a cut colour, from its own WGSL.
 *
 * @param r - The cut's red.
 * @param g - Its green.
 * @param b - Its blue.
 * @returns The alpha.
 */
function light(r: number, g: number, b: number): number {
  return evaluate(BLOOM_DOWN_WGSL, { from: "light", to: "light" }, { cut: { r, g, b } });
}

/**
 * The angle of a direction, in whole degrees from 0 up to 360.
 *
 * @param direction - The direction.
 * @returns The degrees.
 */
function degreesOf(direction: Vec2): number {
  return Math.round(((Math.atan2(direction.y, direction.x) * 180) / Math.PI + 360) % 360);
}

/**
 * How far a number is from the nearest whole one.
 *
 * @param value - The number.
 * @returns 0 up to 0.5.
 */
function offGrid(value: number): number {
  return Math.abs(value - Math.round(value));
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

  // Bug: a stage that reads its input around the head: a read off the clamp, a neighbour's pixels in a pooled texture;
  // or a GLSL twin that takes another count of taps.
  it("reads its input through sampleInput only, as many times in both languages", () => {
    expect(stage.wgsl).not.toMatch(/\btextureSample(?:Level)?\s*\(/);
    expect(stage.glsl).not.toMatch(/\btexture(?:Lod)?\s*\(/);
    expect(samplesOf(stage.glsl)).toBe(samplesOf(stage.wgsl));
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

describe("BloomDown", () => {
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

  // Bug: four taps on one block (the bloom shimmers as the view moves under the coarse texels), taps one texel out
  // at ⅛ whatever the reach (the middle of the footprint only), or the cuts summed, not averaged (four times the light).
  it("takes 4 taps on the diagonals of its pixel, reach texels out, and averages their cuts", () => {
    const loop = loopOf(BLOOM_DOWN_WGSL);
    const corners = turnsOf(BLOOM_DOWN_WGSL, "corner", loop?.turns ?? 0);

    expect(loop).toEqual({ turns: 4, taps: 1 });
    expect(samplesOf(BLOOM_DOWN_WGSL)).toBe(4);
    expect(corners.map(corner => [corner.x, corner.y])).toEqual([
      [1, 1],
      [-1, 1],
      [-1, -1],
      [1, -1]
    ]);
    expect(evaluate(BLOOM_DOWN_WGSL, { from: "d", to: "d" }, { reach: 2 })).toBe(2);
    expect(evaluate(BLOOM_DOWN_WGSL, { from: "return", to: "return" }, { sum: 4 })).toBe(1);
  });
});

describe("BloomBlur", () => {
  // Bug: a ring that collapses or doubles up (taps on top of each other: the bloom breaks into dots), rings at another
  // distance than sigma and half of it, or a tap on a texel's row or column, where the linear sampler reads fewer
  // than 4 texels.
  it("takes 13 taps: the centre, a ring of 6 at sigma, another 30° off it at half of sigma, all off the texel grid", () => {
    const loop = loopOf(BLOOM_BLUR_WGSL);
    const outer = turnsOf(BLOOM_BLUR_WGSL, "outer", loop?.turns ?? 0);
    const inner = outer.map(
      direction =>
        evaluate(
          BLOOM_BLUR_WGSL,
          { from: "inner", to: "inner" },
          { outer: direction }
        ) as unknown as Vec2
    );

    expect(loop).toEqual({ turns: 6, taps: 2 });
    expect(samplesOf(BLOOM_BLUR_WGSL)).toBe(13);
    expect(outer.map(direction => degreesOf(direction))).toEqual([15, 75, 135, 195, 255, 315]);
    expect(inner.map(direction => degreesOf(direction))).toEqual([45, 105, 165, 225, 285, 345]);

    for (const direction of [...outer, ...inner]) {
      expect(Math.hypot(direction.x, direction.y)).toBeCloseTo(1, 6);
    }

    for (const sigma of CHAIN_SIGMAS) {
      const far = evaluate(BLOOM_BLUR_WGSL, { from: "far", to: "far" }, { sigma });
      const near = evaluate(BLOOM_BLUR_WGSL, { from: "near", to: "near" }, { far });

      expect([far, near]).toEqual([sigma, sigma / 2]);

      for (const [ring, reach] of [
        [outer, far],
        [inner, near]
      ] as const) {
        for (const direction of ring) {
          expect(offGrid(direction.x * reach), `${sigma}: ${direction.x * reach}`).toBeGreaterThan(
            0.01
          );
          expect(offGrid(direction.y * reach), `${sigma}: ${direction.y * reach}`).toBeGreaterThan(
            0.01
          );
        }
      }
    }
  });

  // Bug: weights of another curve, or not normalised: the bloom brightens or darkens as the kernel changes.
  it("weighs a tap d texels out by exp(-d² / (2 sigma²)), normalised by the 13 weights' sum", () => {
    const turns = loopOf(BLOOM_BLUR_WGSL)?.turns ?? 0;
    const nearWeight = evaluate(BLOOM_BLUR_WGSL, { from: "nearWeight", to: "nearWeight" }, {});
    const farWeight = evaluate(BLOOM_BLUR_WGSL, { from: "farWeight", to: "farWeight" }, {});

    for (const sigma of CHAIN_SIGMAS) {
      expect(nearWeight).toBeCloseTo(Math.exp(-((sigma / 2) ** 2) / (2 * sigma * sigma)), 12);
      expect(farWeight).toBeCloseTo(Math.exp(-(sigma ** 2) / (2 * sigma * sigma)), 12);
    }

    // An input of 1 everywhere: the centre weighs 1, each turn of the loop one tap of each ring.
    const sum = 1 + turns * (nearWeight + farWeight);

    expect(
      evaluate(BLOOM_BLUR_WGSL, { from: "return", to: "return" }, { sum, nearWeight, farWeight })
    ).toBeCloseTo(1, 12);
  });
});
