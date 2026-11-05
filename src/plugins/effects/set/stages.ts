/**
 * @file effects/set — the shared stages a chain member of the set draws its second texture with: `BloomCut` (what is
 * above a threshold), `Downsample` (a 4-tap box) and `GaussAlong` (a 9-tap Gaussian along one axis). Each is a
 * `defineFilter` that draws alone, listed in a member's `inputs` and named by its chain's steps; none is a root
 * export (a game that wants a chain writes its own stages). Before each body the set head and `inputTexel()`.
 */
import { defineFilter } from "../filters/define";
import type { FilterComponent } from "../filters/types";
import { withSetGlsl, withSetWgsl } from "./head";

/**
 * The WGSL the stages put between the set head and their bodies: `inputTexel()`, one texel of the input in the 0..1 of
 * `inputPlace`. Live a stage's input is a share of a pooled texture, its clamp half a texel in from the frame, so one
 * texel of uv (`uInputPixel.zw`) over the clamp's span is one texel of the frame on both axes.
 */
export const STAGE_WGSL = /* wgsl */ `fn inputTexel() -> vec2<f32> {
  return gfu.uInputPixel.zw / (gfu.uInputClamp.zw - gfu.uInputClamp.xy);
}

`;

/** The GLSL twin of `STAGE_WGSL`. */
export const STAGE_GLSL = /* glsl */ `vec2 inputTexel() {
  return uInputPixel.zw / (uInputClamp.zw - uInputClamp.xy);
}

`;

/**
 * A stage's WGSL body with the set head and `inputTexel()` before it. A call, so a bundle that drops the stage drops
 * the text too.
 *
 * @param body - The stage's WGSL body.
 * @returns The head, the helper, then the body.
 * @example
 * ```ts
 * withStageWgsl("@fragment fn mainFragment").includes("fn inputTexel()"); // true
 * ```
 */
export function withStageWgsl(body: string): string {
  return withSetWgsl(STAGE_WGSL + body);
}

/**
 * A stage's GLSL body with the set head and `inputTexel()` before it, for the same reason as `withStageWgsl`.
 *
 * @param body - The stage's GLSL body.
 * @returns The head, the helper, then the body.
 * @example
 * ```ts
 * withStageGlsl("void main() {}").includes("vec2 inputTexel()"); // true
 * ```
 */
export function withStageGlsl(body: string): string {
  return withSetGlsl(STAGE_GLSL + body);
}

/**
 * The WGSL body of `BloomCut`: of the premultiplied input, what is above `threshold` of its own alpha,
 * `max(c.rgb − threshold × c.a, 0)`, so a half-transparent edge is cut at its share of the threshold. Its alpha is its
 * brightest channel: light covers as much as it shines, and where nothing is bright the cut is transparent black. One
 * sample: drawn at ½, it reads the 2 × 2 texels under it through the linear sampler.
 */
export const BLOOM_CUT_WGSL = /* wgsl */ `@fragment
fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let c = sampleInput(inputPlace(uv));
  let cut = max(c.rgb - fu.threshold * c.a, vec3<f32>(0.0));
  let light = max(max(cut.r, cut.g), cut.b);

  return vec4<f32>(cut, light);
}
`;

/** The GLSL twin of `BLOOM_CUT_WGSL`. */
export const BLOOM_CUT_GLSL = /* glsl */ `void main() {
  vec4 c = sampleInput(inputPlace(vTextureCoord));
  vec3 cut = max(c.rgb - threshold * c.a, vec3(0.0));
  float light = max(max(cut.r, cut.g), cut.b);

  finalColor = vec4(cut, light);
}
`;

/**
 * The WGSL body of `Downsample`, a 4-tap box: drawn at half the scale of its input, each pixel stands on the corner of
 * 2 × 2 input texels, and its taps one texel out on both diagonals each read a 2 × 2 block through the linear sampler:
 * the mean of the 4 × 4 texels around it. No uniform.
 */
export const DOWNSAMPLE_WGSL = /* wgsl */ `@fragment
fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let n = inputPlace(uv);
  let d = inputTexel();
  let falling = sampleInput(n - d) + sampleInput(n + d);
  let rising = sampleInput(n + vec2<f32>(d.x, -d.y)) + sampleInput(n + vec2<f32>(-d.x, d.y));

  return (falling + rising) * 0.25;
}
`;

/** The GLSL twin of `DOWNSAMPLE_WGSL`. */
export const DOWNSAMPLE_GLSL = /* glsl */ `void main() {
  vec2 n = inputPlace(vTextureCoord);
  vec2 d = inputTexel();
  vec4 falling = sampleInput(n - d) + sampleInput(n + d);
  vec4 rising = sampleInput(n + vec2(d.x, -d.y)) + sampleInput(n + vec2(-d.x, d.y));

  finalColor = (falling + rising) * 0.25;
}
`;

/**
 * The WGSL body of `GaussAlong`, a 9-tap Gaussian along `dir` (`[1, 0]` or `[0, 1]`) with `sigma` in texels of its
 * input: tap `k` (−4..4) stands `k × sigma / 2` texels out and weighs `exp(−k² / 8)`, the curve at that place, and
 * the sum is divided by the weights' sum. So the taps cover ±2 sigma, 95 % of the curve, at any sigma; the chain caps
 * sigma at 8, 4 texels between taps on an input already boxed down.
 */
export const GAUSS_ALONG_WGSL = /* wgsl */ `@fragment
fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let n = inputPlace(uv);
  let reach = fu.sigma * 0.5;
  let stride = fu.dir * inputTexel() * reach;
  var sum = vec4<f32>(0.0);
  var total = 0.0;

  for (var k = -4; k <= 4; k++) {
    let w = exp(-f32(k * k) / 8.0);
    sum += sampleInput(n + stride * f32(k)) * w;
    total += w;
  }

  return sum / total;
}
`;

/** The GLSL twin of `GAUSS_ALONG_WGSL`. */
export const GAUSS_ALONG_GLSL = /* glsl */ `void main() {
  vec2 n = inputPlace(vTextureCoord);
  float reach = sigma * 0.5;
  vec2 stride = dir * inputTexel() * reach;
  vec4 sum = vec4(0.0);
  float total = 0.0;

  for (int k = -4; k <= 4; k++) {
    float w = exp(-float(k * k) / 8.0);
    sum += sampleInput(n + stride * float(k)) * w;
    total += w;
  }

  finalColor = sum / total;
}
`;

/** The whole WGSL `BloomCut` is defined with: the set head, the stages' helper, then the body. */
const BLOOM_CUT_SOURCE = /*#__PURE__*/ withStageWgsl(BLOOM_CUT_WGSL);

/** The whole GLSL `BloomCut` is defined with. */
const BLOOM_CUT_GLSL_SOURCE = /*#__PURE__*/ withStageGlsl(BLOOM_CUT_GLSL);

/** The whole WGSL `Downsample` is defined with. */
const DOWNSAMPLE_SOURCE = /*#__PURE__*/ withStageWgsl(DOWNSAMPLE_WGSL);

/** The whole GLSL `Downsample` is defined with. */
const DOWNSAMPLE_GLSL_SOURCE = /*#__PURE__*/ withStageGlsl(DOWNSAMPLE_GLSL);

/** The whole WGSL `GaussAlong` is defined with. */
const GAUSS_ALONG_SOURCE = /*#__PURE__*/ withStageWgsl(GAUSS_ALONG_WGSL);

/** The whole GLSL `GaussAlong` is defined with. */
const GAUSS_ALONG_GLSL_SOURCE = /*#__PURE__*/ withStageGlsl(GAUSS_ALONG_GLSL);

/** The first stage of `Bloom`: what is above `threshold`, premultiplied, at ½. One sample. */
export const BloomCut: FilterComponent<{ threshold: number; enabled: boolean; order: number }> =
  /*#__PURE__*/ defineFilter("effects.bloomCut", {
    wgsl: BLOOM_CUT_SOURCE,
    glsl: BLOOM_CUT_GLSL_SOURCE,
    uniforms: { threshold: 0.7 }
  });

/** A step down to half the scale of its input: the mean of the 4 × 4 texels around each pixel. 4 samples. */
export const Downsample: FilterComponent<{ enabled: boolean; order: number }> =
  /*#__PURE__*/ defineFilter("effects.downsample", {
    wgsl: DOWNSAMPLE_SOURCE,
    glsl: DOWNSAMPLE_GLSL_SOURCE
  });

/** A Gaussian of `sigma` texels along `dir`, 9 taps over ±2 sigma. 9 samples. */
export const GaussAlong: FilterComponent<{
  dir: readonly number[];
  sigma: number;
  enabled: boolean;
  order: number;
}> = /*#__PURE__*/ defineFilter("effects.gaussAlong", {
  wgsl: GAUSS_ALONG_SOURCE,
  glsl: GAUSS_ALONG_GLSL_SOURCE,
  uniforms: { dir: [1, 0], sigma: 0 }
});
