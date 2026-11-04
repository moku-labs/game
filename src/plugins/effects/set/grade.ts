/**
 * @file effects/set — `Grade`: contrast, brightness, saturation and a tint of a view. One pass, one sample of the
 * input; on WebGPU a value change rides the quad of stage 2 from its third write, where Pixi's `ColorMatrix` pays a
 * filter pass for every value.
 */
import { defineFilter } from "../filters/define";
import type { FilterComponent } from "../filters/types";
import { withSetGlsl, withSetWgsl } from "./head";
import type { GradeValue } from "./types";

/**
 * The WGSL body of `Grade`. The input is premultiplied: its colour is divided by its alpha (a transparent pixel's
 * colour is 0, and stays 0), graded (contrast about 0.5, brightness, saturation against the Rec. 709 luma, the tint),
 * clamped to 0..1 and multiplied by the alpha again, which stays as it was.
 */
export const GRADE_WGSL = /* wgsl */ `const GRADE_LUMA = vec3<f32>(0.2126, 0.7152, 0.0722);

@fragment
fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let c = sampleInput(inputPlace(uv));
  var rgb = c.rgb / max(c.a, 1e-6);

  rgb = (rgb - 0.5) * fu.contrast + 0.5;
  rgb = rgb * fu.brightness;
  rgb = mix(vec3<f32>(dot(rgb, GRADE_LUMA)), rgb, fu.saturation);
  rgb = clamp(rgb * fu.tint, vec3<f32>(0.0), vec3<f32>(1.0));

  return vec4<f32>(rgb * c.a, c.a);
}
`;

/** The GLSL twin of `GRADE_WGSL`. */
export const GRADE_GLSL = /* glsl */ `const vec3 GRADE_LUMA = vec3(0.2126, 0.7152, 0.0722);

void main() {
  vec4 c = sampleInput(inputPlace(vTextureCoord));
  vec3 rgb = c.rgb / max(c.a, 1e-6);

  rgb = (rgb - 0.5) * contrast + 0.5;
  rgb = rgb * brightness;
  rgb = mix(vec3(dot(rgb, GRADE_LUMA)), rgb, saturation);
  rgb = clamp(rgb * tint, vec3(0.0), vec3(1.0));

  finalColor = vec4(rgb * c.a, c.a);
}
`;

/** The whole WGSL `Grade` is defined with: the set head, then the body. */
const GRADE_SOURCE = /*#__PURE__*/ withSetWgsl(GRADE_WGSL);

/** The whole GLSL `Grade` is defined with. */
const GRADE_GLSL_SOURCE = /*#__PURE__*/ withSetGlsl(GRADE_GLSL);

/**
 * A colour grade of a view: `contrast` about the middle grey, then `brightness`, then `saturation` against the luma,
 * then a multiply by `tint`. Each number is 1 for no change, 0..2; `saturation: 0` is grey. The alpha is kept. In place
 * of `ColorMatrix` where a value moves: on WebGPU a tween draws on the view's own quad, no pass, from its third frame.
 * List it in a feature's `filters`, as a game's own filter. One render pass, one sample.
 *
 * @example
 * ```ts
 * // A locked level card goes grey, and a kept picture holds it: a still view pays no pass.
 * Grade({ saturation: 0 }).value.saturation; // 0
 * Grade.filter.cache; // "local"
 * ```
 */
export const Grade: FilterComponent<GradeValue> = /*#__PURE__*/ defineFilter("effects.grade", {
  wgsl: GRADE_SOURCE,
  glsl: GRADE_GLSL_SOURCE,
  uniforms: { brightness: 1, contrast: 1, saturation: 1, tint: { color: 0xff_ff_ff } }
});
