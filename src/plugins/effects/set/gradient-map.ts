/**
 * @file effects/set — `GradientMap`: a view recoloured by its light, from a dark colour through a middle one to a
 * light one. One pass, one sample of the input; on WebGPU a value change rides the quad of stage 2 from its third
 * write.
 */
import { defineFilter } from "../filters/define";
import type { FilterComponent } from "../filters/types";
import { withSetGlsl, withSetWgsl } from "./head";
import type { GradientMapValue } from "./types";

/**
 * The WGSL body of `GradientMap`. The input is premultiplied: its straight colour is `c.rgb / c.a` (an alpha of at
 * least 1e-5, so a transparent pixel is black, not NaN). Its Rec. 709 luma, clamped to 0..1, picks the colour: under
 * a half it mixes `dark` to `middle`, from a half `middle` to `light` (`step(0.5, l)` picks the half, no branch).
 * `amount`, clamped to 0..1, mixes the straight colour to that one, and the result is premultiplied again by the
 * input's alpha, which stays.
 */
export const GRADIENT_MAP_WGSL = /* wgsl */ `@fragment
fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let n = inputPlace(uv);
  let c = sampleInput(n);
  let s = c.rgb / max(c.a, 1e-5);
  let l = clamp(dot(s, vec3<f32>(0.2126, 0.7152, 0.0722)), 0.0, 1.0);
  let m = mix(mix(fu.dark, fu.middle, l * 2.0), mix(fu.middle, fu.light, l * 2.0 - 1.0), step(0.5, l));
  let o = mix(s, m, clamp(fu.amount, 0.0, 1.0));

  return vec4<f32>(o * c.a, c.a);
}
`;

/** The GLSL twin of `GRADIENT_MAP_WGSL`. */
export const GRADIENT_MAP_GLSL = /* glsl */ `void main() {
  vec2 n = inputPlace(vTextureCoord);
  vec4 c = sampleInput(n);
  vec3 s = c.rgb / max(c.a, 1e-5);
  float l = clamp(dot(s, vec3(0.2126, 0.7152, 0.0722)), 0.0, 1.0);
  vec3 m = mix(mix(dark, middle, l * 2.0), mix(middle, light, l * 2.0 - 1.0), step(0.5, l));
  vec3 o = mix(s, m, clamp(amount, 0.0, 1.0));

  finalColor = vec4(o * c.a, c.a);
}
`;

/** The whole WGSL `GradientMap` is defined with: the set head, then the body. */
const GRADIENT_MAP_SOURCE = /*#__PURE__*/ withSetWgsl(GRADIENT_MAP_WGSL);

/** The whole GLSL `GradientMap` is defined with. */
const GRADIENT_MAP_GLSL_SOURCE = /*#__PURE__*/ withSetGlsl(GRADIENT_MAP_GLSL);

/**
 * A view recoloured by its light: its Rec. 709 luma maps black to `dark`, a half to `middle` and white to `light`,
 * mixed straight between them, and `amount` (0..1) mixes the view's own colour to the mapped one. The alpha is kept.
 * For a sepia memory, a night tint, a duotone. List it in a feature's `filters`, as a game's own filter. One render
 * pass, one sample; on WebGPU a tween of `amount` draws on the view's own quad, no pass, from its third frame.
 *
 * @example
 * ```ts
 * // An old memory turns sepia, then its colour comes back.
 * GradientMap({ dark: 0x2b1a0e, middle: 0x9c6b3c, light: 0xf5e6c8 }).value.amount; // 1
 * view.tween(GradientMap, { amount: 0 }, { ms: 400 });
 * ```
 */
export const GradientMap: FilterComponent<GradientMapValue> = /*#__PURE__*/ defineFilter(
  "effects.gradientMap",
  {
    wgsl: GRADIENT_MAP_SOURCE,
    glsl: GRADIENT_MAP_GLSL_SOURCE,
    uniforms: {
      dark: { color: 0x00_00_00 },
      middle: { color: 0x80_80_80 },
      light: { color: 0xff_ff_ff },
      amount: 1
    }
  }
);
