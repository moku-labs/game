/**
 * @file effects/set — `Bloom`: light around the bright parts of a view. The one member with a chain: its input `bright`
 * is the view's light above `threshold`, cut at ½, boxed down to ¼ (and to ⅛ for a wide radius) and blurred there along
 * x and y; the body adds it back by `strength`. 5 passes at the bench's resolution 2, 6 at the phone's 2.625. A chain
 * member never rides the quad: a value change runs the chain again and redraws the kept picture's filter (stage 3).
 */
import { defineFilter } from "../filters/define";
import type { FilterChainContext, FilterComponent, FilterStep } from "../filters/types";
import { withSetGlsl, withSetWgsl } from "./head";
import { BloomCut, Downsample, GaussAlong } from "./stages";
import type { BloomValue } from "./types";

/** The most texels the Gaussian's sigma may reach: past it the taps stand more than 4 texels apart and band. */
const MAX_SIGMA = 8;

/** The scale of the cut: half the resolution of the view's input. */
const HALF = 1 / 2;

/** The scale the 4-step ladder blurs at. */
const QUARTER = 1 / 4;

/** The scale the 5-step ladder blurs at, one more box down. */
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

/** The uniforms of the cut step, written in place by every run of the chain. */
type CutUniforms = { threshold: number };

/** The uniforms of a Gaussian step, its sigma written in place by every run of the chain. */
type AlongUniforms = { readonly dir: readonly [number, number]; sigma: number };

/** One ladder of the chain, made once: the steps the chain answers, and the uniform objects it writes in place. */
type Ladder = {
  readonly steps: readonly FilterStep[];
  /** The scale the Gaussian runs at: the last box's. */
  readonly scale: number;
  readonly cut: CutUniforms;
  readonly alongX: AlongUniforms;
  readonly alongY: AlongUniforms;
};

/**
 * Makes one ladder: the cut at ½, a box down to each of `boxes`, the Gaussian along x and along y at the last one.
 *
 * @param boxes - The scales of the boxes, in order.
 * @returns The ladder, its steps frozen, its uniform objects open to the chain.
 */
function ladderOf(boxes: readonly number[]): Ladder {
  const scale = boxes.at(-1) ?? QUARTER;
  const cut: CutUniforms = { threshold: 0 };
  const alongX: AlongUniforms = { dir: Object.freeze([1, 0] as const), sigma: 0 };
  const alongY: AlongUniforms = { dir: Object.freeze([0, 1] as const), sigma: 0 };
  const steps: readonly FilterStep[] = Object.freeze([
    Object.freeze({ stage: BloomCut, scale: HALF, uniforms: cut }),
    ...boxes.map(box => Object.freeze({ stage: Downsample, scale: box })),
    Object.freeze({ stage: GaussAlong, scale, uniforms: alongX }),
    Object.freeze({ stage: GaussAlong, scale, uniforms: alongY })
  ]);

  return { steps, scale, cut, alongX, alongY };
}

/**
 * Makes the two ladders of the chain, once. A function: the module-scope rule sees no collection literal, and a bundle
 * that drops `Bloom` drops the call and the stages with it.
 *
 * @returns The 4-step ladder (½, ¼, ¼, ¼) and the 5-step one (½, ¼, ⅛, ⅛, ⅛).
 */
function bloomLadders(): { readonly four: Ladder; readonly five: Ladder } {
  return { four: ladderOf([QUARTER]), five: ladderOf([QUARTER, EIGHTH]) };
}

/** The two ladders, made at module scope once: the chain answers one of them, written in place, on every call. */
const LADDERS = /*#__PURE__*/ bloomLadders();

/**
 * The chain of `bright`: the 5-step ladder when the radius in texels at ¼ is over `MAX_SIGMA`, otherwise the 4-step
 * one; sigma is the radius in texels at the ladder's last scale, capped at `MAX_SIGMA`, so past it the bloom stops
 * widening. The answer is one of two arrays made once, its threshold and sigmas written in place: the engine copies
 * what it reads, and a strength tween, which runs the chain in every frame, allocates nothing here.
 *
 * @param value - The stored value of the `Bloom`.
 * @param context - The resolution of the view's input.
 * @returns The steps, the same array for every call of a ladder.
 */
function bloomChain(
  value: Readonly<BloomValue>,
  context: FilterChainContext
): readonly FilterStep[] {
  const texels = value.radius * context.resolution;
  const ladder = texels * QUARTER > MAX_SIGMA ? LADDERS.five : LADDERS.four;
  const sigma = Math.min(Math.max(texels * ladder.scale, 0), MAX_SIGMA);

  ladder.cut.threshold = value.threshold;
  ladder.alongX.sigma = sigma;
  ladder.alongY.sigma = sigma;

  return ladder.steps;
}

/** The whole WGSL `Bloom` is defined with: the set head, then the body. */
const BLOOM_SOURCE = /*#__PURE__*/ withSetWgsl(BLOOM_WGSL);

/** The whole GLSL `Bloom` is defined with. */
const BLOOM_GLSL_SOURCE = /*#__PURE__*/ withSetGlsl(BLOOM_GLSL);

/**
 * Light around the bright parts of a view and its subtree: what is above `threshold` (0..1) of its light, blurred
 * `radius` CSS px wide, added back by `strength` (0..2). For a reward, a gem, a lit lamp: an object, not the screen
 * (over the A26's screen its passes fill 2.5 Mpx a frame at 2.625). List it in a feature's `filters`, as a game's own
 * filter. It reads a second texture drawn by a chain of three stages: 5 passes, or 6 when the radius is over 8 texels
 * at ¼ (radius 16 at the phone's 2.625, 32 at 2). A still view is kept as a picture; a tween of any field runs the
 * chain again and redraws the picture's filter, a pass for each step, in every frame it moves: it never draws on the
 * view's quad. Past a sigma of 8 texels at ⅛ the bloom stops widening.
 *
 * @example
 * ```ts
 * // features/shop/feature.ts lists it: filters: [Bloom]. A reward card blooms gold, then a motion fades it out.
 * Bloom.filter.inputs[0]?.chain({ ...Bloom().value }, { resolution: 2 }).length; // 4
 * view.tween(Bloom, { strength: 0 }, { ms: 400 });
 * ```
 */
export const Bloom: FilterComponent<BloomValue> = /*#__PURE__*/ defineFilter("effects.bloom", {
  wgsl: BLOOM_SOURCE,
  glsl: BLOOM_GLSL_SOURCE,
  uniforms: { strength: 0.6, threshold: 0.7, radius: 16 },
  inputs: { bright: { stages: [BloomCut, Downsample, GaussAlong], chain: bloomChain } }
});
