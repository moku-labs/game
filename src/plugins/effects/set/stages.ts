/**
 * @file effects/set — the shared stages a chain member of the set draws its second texture with: `BloomDown` (what is
 * above a threshold, boxed down in one pass) and `BloomBlur` (a 13-tap blur in two dimensions, one pass). Each is a
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
 * The WGSL body of `BloomDown`: drawn at ¼ or ⅛ of the view's input, it reads that input with 4 taps on the diagonals
 * of its pixel, `reach` texels out on each axis (1 at ¼, 2 at ⅛: the centres of the four quarters of its footprint).
 * Each tap stands on the corner of 4 texels, so the linear sampler reads a 2 × 2 block. Each tap is cut by
 * `threshold` of its own alpha, premultiplied, `max(c.rgb − threshold × c.a, 0)`, so a half-transparent edge is cut at
 * its share of the threshold, and its alpha is its brightest channel: light covers as much as it shines, and where
 * nothing is bright the cut is transparent black. The four cuts are averaged. The corner turns a quarter each tap.
 */
export const BLOOM_DOWN_WGSL = /* wgsl */ `@fragment
fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let n = inputPlace(uv);
  let d = fu.reach * inputTexel();
  var sum = vec4<f32>(0.0);
  var corner = vec2<f32>(1.0);

  for (var k = 0; k < 4; k++) {
    let c = sampleInput(n + corner * d);
    let cut = max(c.rgb - fu.threshold * c.a, vec3<f32>(0.0));
    let light = max(max(cut.r, cut.g), cut.b);
    sum += vec4<f32>(cut, light);
    corner = vec2<f32>(-corner.y, corner.x);
  }

  return sum * 0.25;
}
`;

/** The GLSL twin of `BLOOM_DOWN_WGSL`. */
export const BLOOM_DOWN_GLSL = /* glsl */ `void main() {
  vec2 n = inputPlace(vTextureCoord);
  vec2 d = reach * inputTexel();
  vec4 sum = vec4(0.0);
  vec2 corner = vec2(1.0);

  for (int k = 0; k < 4; k++) {
    vec4 c = sampleInput(n + corner * d);
    vec3 cut = max(c.rgb - threshold * c.a, vec3(0.0));
    float light = max(max(cut.r, cut.g), cut.b);
    sum += vec4(cut, light);
    corner = vec2(-corner.y, corner.x);
  }

  finalColor = sum * 0.25;
}
`;

/**
 * The WGSL body of `BloomBlur`, a blur in two dimensions, in one pass at the scale of its input: the centre and two
 * rings of 6 taps, the inner one at `0.5 × sigma` texels, the outer one at `sigma`. A tap `d` texels out weighs
 * `exp(−d² / (2 × sigma²))`: `exp(−1 / 8)` on the inner ring, `exp(−1 / 2)` on the outer, 1 at the centre, and the sum
 * is divided by the 13 weights' sum. The outer ring stands at 15° + 60° × k, the inner one 30° further, turned 60° a
 * tap: at the chain's sigmas (8, 5.25 at the phone's 2.625) no tap stands on a texel's row or column, so the linear
 * sampler reads the 4 texels around each. The chain caps sigma at 8.
 */
export const BLOOM_BLUR_WGSL = /* wgsl */ `@fragment
fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let n = inputPlace(uv);
  let far = fu.sigma * inputTexel();
  let near = far * 0.5;
  let nearWeight = exp(-0.125);
  let farWeight = exp(-0.5);
  var sum = sampleInput(n);
  var outer = vec2<f32>(0.9659258, 0.258819);

  for (var k = 0; k < 6; k++) {
    let inner = vec2<f32>(0.8660254 * outer.x - 0.5 * outer.y, 0.5 * outer.x + 0.8660254 * outer.y);
    sum += sampleInput(n + inner * near) * nearWeight + sampleInput(n + outer * far) * farWeight;
    outer = vec2<f32>(0.5 * outer.x - 0.8660254 * outer.y, 0.8660254 * outer.x + 0.5 * outer.y);
  }

  return sum / (1.0 + 6.0 * (nearWeight + farWeight));
}
`;

/** The GLSL twin of `BLOOM_BLUR_WGSL`. */
export const BLOOM_BLUR_GLSL = /* glsl */ `void main() {
  vec2 n = inputPlace(vTextureCoord);
  vec2 far = sigma * inputTexel();
  vec2 near = far * 0.5;
  float nearWeight = exp(-0.125);
  float farWeight = exp(-0.5);
  vec4 sum = sampleInput(n);
  vec2 outer = vec2(0.9659258, 0.258819);

  for (int k = 0; k < 6; k++) {
    vec2 inner = vec2(0.8660254 * outer.x - 0.5 * outer.y, 0.5 * outer.x + 0.8660254 * outer.y);
    sum += sampleInput(n + inner * near) * nearWeight + sampleInput(n + outer * far) * farWeight;
    outer = vec2(0.5 * outer.x - 0.8660254 * outer.y, 0.8660254 * outer.x + 0.5 * outer.y);
  }

  finalColor = sum / (1.0 + 6.0 * (nearWeight + farWeight));
}
`;

/** The whole WGSL `BloomDown` is defined with: the set head, the stages' helper, then the body. */
const BLOOM_DOWN_SOURCE = /*#__PURE__*/ withStageWgsl(BLOOM_DOWN_WGSL);

/** The whole GLSL `BloomDown` is defined with. */
const BLOOM_DOWN_GLSL_SOURCE = /*#__PURE__*/ withStageGlsl(BLOOM_DOWN_GLSL);

/** The whole WGSL `BloomBlur` is defined with. */
const BLOOM_BLUR_SOURCE = /*#__PURE__*/ withStageWgsl(BLOOM_BLUR_WGSL);

/** The whole GLSL `BloomBlur` is defined with. */
const BLOOM_BLUR_GLSL_SOURCE = /*#__PURE__*/ withStageGlsl(BLOOM_BLUR_GLSL);

/**
 * The first stage of `Bloom`: what is above `threshold` of the view's input, premultiplied, boxed down to the step's
 * scale in one pass. 4 samples, `reach` texels out.
 */
export const BloomDown: FilterComponent<{
  threshold: number;
  reach: number;
  enabled: boolean;
  order: number;
}> = /*#__PURE__*/ defineFilter("effects.bloomDown", {
  wgsl: BLOOM_DOWN_SOURCE,
  glsl: BLOOM_DOWN_GLSL_SOURCE,
  uniforms: { threshold: 0.7, reach: 1 }
});

/** The second stage of `Bloom`: a blur of `sigma` texels in both dimensions at once, 13 samples. */
export const BloomBlur: FilterComponent<{ sigma: number; enabled: boolean; order: number }> =
  /*#__PURE__*/ defineFilter("effects.bloomBlur", {
    wgsl: BLOOM_BLUR_SOURCE,
    glsl: BLOOM_BLUR_GLSL_SOURCE,
    uniforms: { sigma: 0 }
  });
