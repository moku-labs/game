/**
 * @file effects/set — `Pixelate`: a view drawn in square blocks of one colour. One pass, one sample of the input; on
 * WebGPU a value change rides the quad of stage 2 from its third write.
 */
import { defineFilter } from "../filters/define";
import type { FilterComponent } from "../filters/types";
import { withSetGlsl, withSetWgsl } from "./head";
import type { PixelateValue } from "./types";

/**
 * The WGSL body of `Pixelate`. The pixel's place in CSS px of the frame, `n × inputFrame()`, falls in a block of
 * `size` px counted from the frame's top-left; the pixel reads the block's centre, mapped back to 0..1. The place is
 * held to 0 .. frame − 0.5: the first and the last texel stand at `n` 0 and 1, exactly on a block's edge when `size`
 * divides the frame, and a hair of rounding there (the live pass and the quad place them apart) would pick another
 * block. A `size` of 1 or less (`blocky` 0) reads the pixel's own place: the view as it is. The side is at least 1, so
 * a `size` of 0 never divides by 0: a NaN would survive the `mix` that drops it.
 */
export const PIXELATE_WGSL = /* wgsl */ `@fragment
fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let n = inputPlace(uv);
  let s = inputFrame();
  let px = clamp(n * s, vec2<f32>(0.0), s - 0.5);
  let side = max(fu.size, 1.0);
  let cell = (floor(px / side) + 0.5) * side;
  let blocky = 1.0 - step(fu.size, 1.0);
  let q = mix(n, cell / s, blocky);

  return sampleInput(q);
}
`;

/** The GLSL twin of `PIXELATE_WGSL`. */
export const PIXELATE_GLSL = /* glsl */ `void main() {
  vec2 n = inputPlace(vTextureCoord);
  vec2 s = inputFrame();
  vec2 px = clamp(n * s, vec2(0.0), s - 0.5);
  float side = max(size, 1.0);
  vec2 cell = (floor(px / side) + 0.5) * side;
  float blocky = 1.0 - step(size, 1.0);
  vec2 q = mix(n, cell / s, blocky);

  finalColor = sampleInput(q);
}
`;

/** The whole WGSL `Pixelate` is defined with: the set head, then the body. */
const PIXELATE_SOURCE = /*#__PURE__*/ withSetWgsl(PIXELATE_WGSL);

/** The whole GLSL `Pixelate` is defined with. */
const PIXELATE_GLSL_SOURCE = /*#__PURE__*/ withSetGlsl(PIXELATE_GLSL);

/**
 * A view drawn in square blocks `size` CSS px wide, counted from its top-left, each the colour of the view at the
 * block's centre; a `size` of 1 or less draws the view as it is. For a memory that breaks up, a picture that sharpens
 * as it loads. List it in a feature's `filters`, as a game's own filter. One render pass, one sample; on WebGPU a tween
 * draws on the view's own quad, no pass, from its third frame.
 *
 * @example
 * ```ts
 * // A blurred memory sharpens: its blocks shrink from 8 px to none.
 * Pixelate().value.size; // 8
 * view.tween(Pixelate, { size: 1 }, { ms: 600 });
 * ```
 */
export const Pixelate: FilterComponent<PixelateValue> = /*#__PURE__*/ defineFilter(
  "effects.pixelate",
  {
    wgsl: PIXELATE_SOURCE,
    glsl: PIXELATE_GLSL_SOURCE,
    uniforms: { size: 8 }
  }
);
