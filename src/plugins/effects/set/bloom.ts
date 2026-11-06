/**
 * @file effects/set — `Bloom`: light around the bright parts of a view. The one member with a chain: its input `bright`
 * is the view's light above `threshold`, cut and boxed down to ¼ (⅛ for a wide radius) in one pass and blurred there in
 * one more; the body adds it back by `strength`. 3 passes at any radius and resolution. A chain member never rides the
 * quad: a value change runs the chain again and redraws the kept picture's filter (stage 3).
 */
import { defineFilter } from "../filters/define";
import type { FilterChainContext, FilterComponent, FilterStep } from "../filters/types";
import { withSetGlsl, withSetWgsl } from "./head";
import { BloomBlur, BloomDown } from "./stages";
import type { BloomValue } from "./types";

/** The most texels the blur's sigma may reach: past it the rings stand too far apart on the boxed-down light. */
const MAX_SIGMA = 8;

/** The scale of the ladder for a radius of at most `MAX_SIGMA` texels at it. */
const QUARTER = 1 / 4;

/** The scale of the ladder for a wider radius: one more halving, so sigma stays under its cap longer. */
const EIGHTH = 1 / 8;

/**
 * The WGSL body of `Bloom`: the view's own pixel, plus the blurred light of `bright` at the same place times
 * `strength`, at least 0. Both are premultiplied, so the sum is too; over an opaque pixel the light adds to its colour.
 */
export const BLOOM_WGSL = /* wgsl */ `@fragment
fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let c = sampleInput(inputPlace(uv));

  return c + sampleBright(uv) * max(fu.strength, 0.0);
}
`;

/** The GLSL twin of `BLOOM_WGSL`. */
export const BLOOM_GLSL = /* glsl */ `void main() {
  vec4 c = sampleInput(inputPlace(vTextureCoord));

  finalColor = c + sampleBright(vTextureCoord) * max(strength, 0.0);
}
`;

/** The uniforms of the down step: its threshold written in place by every run of the chain, its reach fixed. */
type DownUniforms = { threshold: number; readonly reach: number };

/** The uniforms of the blur step, its sigma written in place by every run of the chain. */
type BlurUniforms = { sigma: number };

/** One ladder of the chain, made once: the steps the chain answers, and the uniform objects it writes in place. */
type Ladder = {
  readonly steps: readonly FilterStep[];
  /** The scale both steps draw at. */
  readonly scale: number;
  readonly down: DownUniforms;
  readonly blur: BlurUniforms;
};

/**
 * Makes one ladder: the cut boxed down to `scale`, then the blur at the same scale.
 *
 * @param scale - The scale both steps draw at.
 * @param reach - How far out the down step's taps stand, in texels of the view's input: a quarter of its footprint,
 * `1 / (4 × scale)`. A whole number, written as one: a fraction in a uniform comes back boxed at each read of a frame.
 * @returns The ladder, its steps frozen, its uniform objects open to the chain.
 */
function ladderAt(scale: number, reach: number): Ladder {
  const down: DownUniforms = { threshold: 0, reach };
  const blur: BlurUniforms = { sigma: 0 };
  const steps: readonly FilterStep[] = Object.freeze([
    Object.freeze({ stage: BloomDown, scale, uniforms: down }),
    Object.freeze({ stage: BloomBlur, scale, uniforms: blur })
  ]);

  return { steps, scale, down, blur };
}

/**
 * Makes the two ladders of the chain, once. A function: the module-scope rule sees no collection literal, and a bundle
 * that drops `Bloom` drops the call and the stages with it.
 *
 * @returns The ladder at ¼ and the one at ⅛.
 */
function bloomLadders(): { readonly quarter: Ladder; readonly eighth: Ladder } {
  return { quarter: ladderAt(QUARTER, 1), eighth: ladderAt(EIGHTH, 2) };
}

/** The two ladders, made at module scope once: the chain answers one of them, written in place, on every call. */
const LADDERS = /*#__PURE__*/ bloomLadders();

/**
 * The chain of `bright`: the ladder at ⅛ when the radius in texels at ¼ is over `MAX_SIGMA`, otherwise the one at ¼;
 * sigma is the radius in texels at the ladder's scale, capped at `MAX_SIGMA`, so past it the bloom stops widening.
 * The answer is one of two arrays made once, its threshold and sigma written in place: the engine copies what it
 * reads, and a strength tween, which runs the chain in every frame, allocates nothing here.
 *
 * @param value - The stored value of the `Bloom`.
 * @param context - The resolution of the view's input.
 * @returns The two steps, the same array for every call of a ladder.
 */
function bloomChain(
  value: Readonly<BloomValue>,
  context: FilterChainContext
): readonly FilterStep[] {
  const texels = value.radius * context.resolution;
  const ladder = texels * QUARTER > MAX_SIGMA ? LADDERS.eighth : LADDERS.quarter;

  ladder.down.threshold = value.threshold;
  ladder.blur.sigma = Math.min(Math.max(texels * ladder.scale, 0), MAX_SIGMA);

  return ladder.steps;
}

/** The whole WGSL `Bloom` is defined with: the set head, then the body. */
const BLOOM_SOURCE = /*#__PURE__*/ withSetWgsl(BLOOM_WGSL);

/** The whole GLSL `Bloom` is defined with. */
const BLOOM_GLSL_SOURCE = /*#__PURE__*/ withSetGlsl(BLOOM_GLSL);

/**
 * Light around the bright parts of a view and its subtree: what is above `threshold` (0..1) of its light, blurred
 * `radius` CSS px wide, added back by `strength` (0..2). For a reward, a gem, a lit lamp: an object, not the screen
 * (over the A26's screen its passes fill 1.9 Mpx a frame at 2.625). List it in a feature's `filters`, as a game's own
 * filter. It reads a second texture drawn by a chain of two stages, the light cut and boxed down to ¼ (⅛ when the
 * radius is over 8 texels at ¼: radius 16 at the phone's 2.625, 32 at 2) and blurred there: 3 passes at any radius.
 * A still view is kept as a picture; a tween of any field runs the chain again and redraws the picture's filter, 3
 * passes, in every frame it moves: it never draws on the view's quad. Past a sigma of 8 texels at ⅛ the bloom stops
 * widening.
 *
 * @example
 * ```ts
 * // features/shop/feature.ts lists it: filters: [Bloom]. A reward card blooms gold, then a motion fades it out.
 * Bloom.filter.inputs[0]?.chain({ ...Bloom().value }, { resolution: 2 }).length; // 2
 * view.tween(Bloom, { strength: 0 }, { ms: 400 });
 * ```
 */
export const Bloom: FilterComponent<BloomValue> = /*#__PURE__*/ defineFilter("effects.bloom", {
  wgsl: BLOOM_SOURCE,
  glsl: BLOOM_GLSL_SOURCE,
  uniforms: { strength: 0.6, threshold: 0.7, radius: 16 },
  inputs: { bright: { stages: [BloomDown, BloomBlur], chain: bloomChain } }
});
