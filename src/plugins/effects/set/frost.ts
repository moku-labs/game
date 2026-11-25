/**
 * @file effects/set — `Frost`: frosted glass, a backdrop. Its input `blur` starts from back: what was drawn under the
 * window, boxed down and blurred; the body lays the window's own pixels over it. Over a `Source` (F126 stage 5) the
 * renderer draws the chain from the Source's texture once per take and the body on the window's quad, no canvas break;
 * without one it is today's backdrop path, three passes (box, blur, body) and a canvas break per window.
 */
import { defineFilter } from "../filters/define";
import type { FilterChainContext, FilterComponent, FilterStep } from "../filters/types";
import { withSetGlsl, withSetWgsl } from "./head";
import { BloomBlur, FrostDown } from "./stages";
import type { FrostValue } from "./types";

/** The widest blur, CSS px: past it the chain's sigma would stand too far apart on the boxed-down picture. */
export const MAX_BLUR = 48;

/** The texels per CSS px the blur is drawn at, at most: a ¼ of the canvas at 3, the same on a Source at ¼. */
const DENSITY = 0.75;

/** The most texels the blur's sigma may reach at its scale: past it one more halving. */
const MAX_SIGMA = 8;

/** The scales a ladder may draw at, widest first. */
const SCALES = [1, 1 / 2, 1 / 4, 1 / 8, 1 / 16] as const;

/**
 * The WGSL body of `Frost`: the blurred picture under the window times `tint`, the window's own premultiplied pixel over
 * it, opaque where the window draws and nothing where it does not.
 */
export const FROST_WGSL = /* wgsl */ `@fragment
fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let own = sampleInput(inputPlace(uv));
  let blurred = sampleBlur(uv).rgb * fu.tint;

  return vec4<f32>(blurred * (1.0 - own.a) + own.rgb, 1.0) * step(0.001, own.a);
}
`;

/** The GLSL twin of `FROST_WGSL`. */
export const FROST_GLSL = /* glsl */ `void main() {
  vec4 own = sampleInput(inputPlace(vTextureCoord));
  vec3 blurred = sampleBlur(vTextureCoord).rgb * tint;

  finalColor = vec4(blurred * (1.0 - own.a) + own.rgb, 1.0) * step(0.001, own.a);
}
`;

/** The uniforms of the down step, its reach fixed. */
type DownUniforms = { readonly reach: number };

/** The uniforms of the blur step, its sigma written in place by every run of the chain. */
type BlurUniforms = { sigma: number };

/** One ladder: its steps, made once, and the uniform object of its blur. */
type Ladder = {
  readonly steps: readonly FilterStep[];
  readonly scale: number;
  readonly blur: BlurUniforms;
};

/**
 * Makes one ladder: the picture boxed down to `scale`, then the blur at the same scale. The box reads a quarter of its
 * footprint out on each axis, `1 / (4 × scale)` texels of its input.
 *
 * @param scale - The scale both steps draw at.
 * @returns The ladder.
 */
function ladderAt(scale: number): Ladder {
  const down: DownUniforms = { reach: 1 / (4 * scale) };
  const blur: BlurUniforms = { sigma: 0 };
  const steps: readonly FilterStep[] = Object.freeze([
    Object.freeze({ stage: FrostDown, scale, uniforms: down }),
    Object.freeze({ stage: BloomBlur, scale, uniforms: blur })
  ]);

  return { steps, scale, blur };
}

/**
 * Makes a ladder for every scale, once. A function: the module-scope rule sees no collection literal.
 *
 * @returns The ladders, widest first.
 */
function frostLadders(): readonly Ladder[] {
  return SCALES.map(scale => ladderAt(scale));
}

/** The ladders, made at module scope once: the chain answers one of them, its sigma written in place. */
const LADDERS = /*#__PURE__*/ frostLadders();

/** The steps of a blur of 0: none, the body reads what was drawn under the window as it is. */
const NO_STEPS: readonly FilterStep[] = Object.freeze([]);

/**
 * The chain of `blur`: the widest scale that draws at most `DENSITY` texels per CSS px of its input (¼ of a canvas at
 * 2.625, and 1 of a Source at ¼ of it: the same texels either way, so the glass reads the same on both paths), one more
 * halving while sigma would pass `MAX_SIGMA`; sigma is the blur in texels at that scale. `blur` is clamped to 0..48; 0
 * runs no chain.
 *
 * @param value - The stored value of the `Frost`.
 * @param context - The resolution of what was drawn under the window.
 * @returns The two steps, the same array for every call of a ladder; none for a blur of 0.
 */
function frostChain(
  value: Readonly<FrostValue>,
  context: FilterChainContext
): readonly FilterStep[] {
  const blur = Math.min(Math.max(value.blur, 0), MAX_BLUR);

  if (Number.isNaN(blur) || blur <= 0) return NO_STEPS;

  let at = 0;

  while (at < LADDERS.length - 1 && context.resolution * (LADDERS[at]?.scale ?? 1) > DENSITY)
    at += 1;
  while (
    at < LADDERS.length - 1 &&
    blur * context.resolution * (LADDERS[at]?.scale ?? 1) > MAX_SIGMA
  )
    at += 1;

  const ladder = LADDERS[at] ?? ladderAt(1);

  ladder.blur.sigma = Math.min(blur * context.resolution * ladder.scale, MAX_SIGMA);

  return ladder.steps;
}

/** The whole WGSL `Frost` is defined with: the set head, then the body. */
const FROST_SOURCE = /*#__PURE__*/ withSetWgsl(FROST_WGSL);

/** The whole GLSL `Frost` is defined with. */
const FROST_GLSL_SOURCE = /*#__PURE__*/ withSetGlsl(FROST_GLSL);

/**
 * Frosted glass on a view: what is drawn under it, blurred `blur` CSS px wide (0..48, 0 for none) and multiplied by
 * `tint`, with the view's own pixels laid over it; outside them nothing. A backdrop: put `Source()` on the view under the
 * glass (the room, the board) and the frost runs no filter pass and breaks no canvas pass. Its blur is drawn off the
 * canvas once per take of the Source, its body on the window's quad; a moving window takes nothing again. With no
 * Source under it, today's backdrop path: 3 passes and a canvas break per window, and a dev build warns once per window
 * (`effects:frost-no-source`). List it in a feature's `filters`.
 *
 * @example
 * ```ts
 * // views/ward.tsx: the room is the Source, the note is the glass over it.
 * // <view key="ward-room" components={[Source()]}>…</view>
 * // <view key="note" components={[Frost({ blur: 12, tint: 0x62585b })]}>…</view>
 * Frost({ blur: 12 }).value; // { blur: 12, tint: 0xffffff, enabled: true, order: 0 }
 * Frost.filter.backdrop; // true
 * ```
 */
export const Frost: FilterComponent<FrostValue> = /*#__PURE__*/ defineFilter("effects.frost", {
  wgsl: FROST_SOURCE,
  glsl: FROST_GLSL_SOURCE,
  uniforms: { blur: 12, tint: { color: 0xff_ff_ff } },
  backdrop: true,
  inputs: { blur: { from: "back", stages: [FrostDown, BloomBlur], chain: frostChain } }
});
