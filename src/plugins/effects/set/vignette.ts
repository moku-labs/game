/**
 * @file effects/set — `Vignette`: a view darkened, or coloured, away from a point. One pass, one sample of the input;
 * on WebGPU a value change rides the quad of stage 2 from its third write.
 */
import { defineFilter } from "../filters/define";
import type { FilterComponent } from "../filters/types";
import { withSetGlsl, withSetWgsl } from "./head";
import type { VignetteValue } from "./types";

/**
 * The WGSL body of `Vignette`: the distance of the pixel's place from `(x, y)`, in 0..1 of the view on each axis, eased
 * from `radius` to `radius + soft` (a `soft` of at least 1e-4: `smoothstep` of two equal edges is undefined), times
 * `amount` clamped to 0..1, mixes the colour towards `color` at the input's own alpha. The alpha stays.
 */
export const VIGNETTE_WGSL = /* wgsl */ `@fragment
fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let n = inputPlace(uv);
  let c = sampleInput(n);
  let d = distance(n, vec2<f32>(fu.x, fu.y));
  let v = smoothstep(fu.radius, fu.radius + max(fu.soft, 1e-4), d) * clamp(fu.amount, 0.0, 1.0);

  return vec4<f32>(mix(c.rgb, fu.color * c.a, v), c.a);
}
`;

/** The GLSL twin of `VIGNETTE_WGSL`. */
export const VIGNETTE_GLSL = /* glsl */ `void main() {
  vec2 n = inputPlace(vTextureCoord);
  vec4 c = sampleInput(n);
  float d = distance(n, vec2(x, y));
  float v = smoothstep(radius, radius + max(soft, 1e-4), d) * clamp(amount, 0.0, 1.0);

  finalColor = vec4(mix(c.rgb, color * c.a, v), c.a);
}
`;

/** The whole WGSL `Vignette` is defined with: the set head, then the body. */
const VIGNETTE_SOURCE = /*#__PURE__*/ withSetWgsl(VIGNETTE_WGSL);

/** The whole GLSL `Vignette` is defined with. */
const VIGNETTE_GLSL_SOURCE = /*#__PURE__*/ withSetGlsl(VIGNETTE_GLSL);

/**
 * A view darkened outside a disc: inside `radius` of the point `x`, `y` it is drawn as it is, from there over `soft` it
 * fades to `color`, by `amount`. The point and the lengths are in 0..1 of the view on each axis, so on a view twice as
 * wide as tall the disc is an ellipse. The alpha is kept. List it in a feature's `filters`, as a game's own filter. One
 * render pass, one sample; on WebGPU a tween draws on the view's own quad, no pass, from its third frame.
 *
 * @example
 * ```ts
 * // A dream scene closes in at the edges, then the vignette fades away as the player wakes.
 * Vignette({ radius: 0.3, soft: 0.4 }).value.amount; // 1
 * view.tween(Vignette, { amount: 0 }, { ms: 300 });
 * ```
 */
export const Vignette: FilterComponent<VignetteValue> = /*#__PURE__*/ defineFilter(
  "effects.vignette",
  {
    wgsl: VIGNETTE_SOURCE,
    glsl: VIGNETTE_GLSL_SOURCE,
    uniforms: { x: 0.5, y: 0.5, radius: 0.5, soft: 0.25, color: { color: 0x00_00_00 }, amount: 1 }
  }
);
