import { describe, expect, it } from "vitest";
import { SET_GLSL, SET_WGSL } from "../../../set/head";

// ---------------------------------------------------------------------------
// Unit test: the set head. Bun has no GPU, so the two helpers are read out of
// the WGSL and the GLSL and evaluated here, one axis at a time, on the clamps a
// body meets: Pixi's live pass (FilterSystem `_updateFilterUniforms`: half a
// texel in from the frame, the frame often a share of a larger pooled texture)
// and the quad of stage 2 (`shade.ts` `writeGlobals`: half a texel in from the
// whole padded picture; `kept-shade.test.ts` pins those numbers).
// ---------------------------------------------------------------------------

/** `uInputClamp`: x0, y0, x1, y1 in uv. */
type Clamp = readonly [number, number, number, number];

/** One helper evaluated on one axis. */
type Axis = (place: number, clamp: Clamp) => number;

/**
 * The expression of a helper on one axis: the clamp's `.xy` and `.zw` become the axis's numbers, a vector literal its
 * number, the argument its component.
 *
 * @param expression - The WGSL or GLSL expression.
 * @param argument - The helper's argument, `uv` or `n`.
 * @param axis - 0 for x, 1 for y.
 * @returns The expression in TypeScript.
 */
function onAxis(expression: string, argument: string, axis: 0 | 1): string {
  return expression
    .replaceAll(/(?:gfu\.)?uInputClamp\.xy/g, `c[${axis}]`)
    .replaceAll(/(?:gfu\.)?uInputClamp\.zw/g, `c[${axis + 2}]`)
    .replaceAll(/vec2<f32>\(([\d.]+)\)/g, "$1")
    .replaceAll(new RegExp(String.raw`\b${argument}\b`, "g"), "p");
}

/**
 * A helper of the head as a function of one axis, with `mix` and `clamp` as the shading languages define them.
 *
 * @param source - `SET_WGSL` or `SET_GLSL`.
 * @param pattern - Finds the expression the helper computes in its first group.
 * @param argument - The helper's argument.
 * @param axis - 0 for x, 1 for y.
 * @returns The helper on that axis.
 */
function helperOf(source: string, pattern: RegExp, argument: string, axis: 0 | 1): Axis {
  const expression = pattern.exec(source)?.[1];

  if (expression === undefined) throw new Error(`no ${pattern.source} in the head`);

  return new Function(
    "p",
    "c",
    `const mix = (a, b, t) => a + (b - a) * t;
     const clamp = (x, low, high) => Math.min(Math.max(x, low), high);
     return ${onAxis(expression, argument, axis)};`
  ) as Axis;
}

/** The two helpers of each language, on the x axis: the y axis reads the other half of the same vectors. */
const LANGUAGES = {
  wgsl: {
    inputPlace: helperOf(
      SET_WGSL,
      /fn inputPlace\(uv: vec2<f32>\) -> vec2<f32> \{\s*return ([^;]+);/,
      "uv",
      0
    ),
    sampleAt: helperOf(SET_WGSL, /textureSampleLevel\(uTexture, uSampler, (.+), 0\.0\);/, "n", 0)
  },
  glsl: {
    inputPlace: helperOf(SET_GLSL, /vec2 inputPlace\(vec2 uv\) \{\s*return ([^;]+);/, "uv", 0),
    sampleAt: helperOf(SET_GLSL, /textureLod\(uTexture, (.+), 0\.0\);/, "n", 0)
  }
} as const;

/**
 * Pixi's live clamp of a frame of `frame` texels in a pooled texture of `texture` texels, on one axis.
 *
 * @param frame - Texels of the input frame.
 * @param texture - Texels of the pooled texture, at least `frame`.
 * @returns The clamp, the axis's numbers in x0 and x1.
 */
function liveClamp(frame: number, texture: number): Clamp {
  return [0.5 / texture, 0, frame / texture - 0.5 / texture, 0];
}

/**
 * The quad's clamp of a padded picture of `texels` texels, on one axis.
 *
 * @param texels - Texels of the picture.
 * @returns The clamp, the axis's numbers in x0 and x1.
 */
function quadClamp(texels: number): Clamp {
  return [0.5 / texels, 0, 1 - 0.5 / texels, 0];
}

describe.each(Object.entries(LANGUAGES))("the %s set head", (_language, helpers) => {
  const { inputPlace, sampleAt } = helpers;

  // Bug: a body's 0..1 starts at the texture's corner instead of the frame's, or ends past it in a pooled texture.
  it("maps the live clamp of a frame to 0 and 1, also in a pooled texture larger than the frame", () => {
    for (const clamp of [liveClamp(200, 200), liveClamp(200, 256)]) {
      expect(inputPlace(clamp[0], clamp)).toBeCloseTo(0, 12);
      expect(inputPlace(clamp[2], clamp)).toBeCloseTo(1, 12);
    }

    // The middle of a 200-texel frame in a 256-texel texture: uv 100 / 256.
    expect(inputPlace(100 / 256, liveClamp(200, 256))).toBeCloseTo(99.5 / 199, 12);
  });

  // Bug: the quad of stage 2 hands the body another 0..1 than the live pass.
  it("maps the quad's clamp of the whole picture to 0 and 1", () => {
    const clamp = quadClamp(148);

    expect(inputPlace(clamp[0], clamp)).toBeCloseTo(0, 12);
    expect(inputPlace(clamp[2], clamp)).toBeCloseTo(1, 12);
  });

  // Bug: a member reads one texel off on the quad and not live: a seam at 2.625 once a tween starts.
  it("gives every texel the same place on the quad and in a pooled live pass", () => {
    const texels = 148;
    const live = liveClamp(texels, 256);
    const quad = quadClamp(texels);

    for (const texel of [0, 1, 73, 146, 147]) {
      const onLive = inputPlace((texel + 0.5) / 256, live);
      const onQuad = inputPlace((texel + 0.5) / texels, quad);

      expect(onLive).toBeCloseTo(texel / (texels - 1), 12);
      expect(onQuad).toBeCloseTo(onLive, 12);
    }
  });

  // Bug: `sampleInput(inputPlace(uv))` reads another texel than the pixel's own.
  it("reads the pixel's own texel back at its place, live and on the quad", () => {
    for (const clamp of [liveClamp(200, 256), quadClamp(148)]) {
      for (const share of [0, 0.25, 0.5, 1]) {
        const uv = clamp[0] + (clamp[2] - clamp[0]) * share;

        expect(sampleAt(inputPlace(uv, clamp), clamp)).toBeCloseTo(uv, 12);
      }
    }
  });

  // Bug: a place outside 0..1 reads past the frame: the pooled texture's other content, an atlas neighbour.
  it("never reads outside the clamp", () => {
    const clamp = liveClamp(200, 256);

    expect(sampleAt(-0.5, clamp)).toBeCloseTo(clamp[0], 12);
    expect(sampleAt(1.5, clamp)).toBeCloseTo(clamp[2], 12);
  });
});
