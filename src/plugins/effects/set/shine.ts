/**
 * @file effects/set — `Shine`: a band of light that sweeps across a view. One pass, one sample of the input; on WebGPU a
 * value change rides the quad of stage 2 from its third write.
 */
import { defineFilter } from "../filters/define";
import type { FilterComponent } from "../filters/types";
import { withSetGlsl, withSetWgsl } from "./head";
import type { ShineValue } from "./types";

/**
 * The WGSL body of `Shine`. `p` is where the pixel stands along the direction `angle`, 0 at the first corner and 1 at
 * the last, as in `RevealLine`; the band is lit within `width` of `position` (at least 1e-4), so a `position` of -0.5 or
 * 1.5 lights nothing for a `width` up to 0.5. The light, `strength × band`, is added to the premultiplied colour at the
 * input's own alpha and clamped to that alpha; the alpha stays, so a transparent pixel stays transparent.
 */
export const SHINE_WGSL = /* wgsl */ `@fragment
fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let n = inputPlace(uv);
  let c = sampleInput(n);
  let dir = vec2<f32>(cos(fu.angle), sin(fu.angle));
  let reach = 0.5 * (abs(dir.x) + abs(dir.y));
  let p = ((n.x - 0.5) * dir.x + (n.y - 0.5) * dir.y + reach) / (2.0 * reach);
  let band = 1.0 - smoothstep(0.0, max(fu.width, 1e-4), abs(p - fu.position));
  let light = max(fu.strength, 0.0) * band * c.a;

  return vec4<f32>(min(c.rgb + vec3<f32>(light), vec3<f32>(c.a)), c.a);
}
`;

/** The GLSL twin of `SHINE_WGSL`. */
export const SHINE_GLSL = /* glsl */ `void main() {
  vec2 n = inputPlace(vTextureCoord);
  vec4 c = sampleInput(n);
  vec2 dir = vec2(cos(angle), sin(angle));
  float reach = 0.5 * (abs(dir.x) + abs(dir.y));
  float p = ((n.x - 0.5) * dir.x + (n.y - 0.5) * dir.y + reach) / (2.0 * reach);
  float band = 1.0 - smoothstep(0.0, max(width, 1e-4), abs(p - position));
  float light = max(strength, 0.0) * band * c.a;

  finalColor = vec4(min(c.rgb + vec3(light), vec3(c.a)), c.a);
}
`;

/** The whole WGSL `Shine` is defined with: the set head, then the body. */
const SHINE_SOURCE = /*#__PURE__*/ withSetWgsl(SHINE_WGSL);

/** The whole GLSL `Shine` is defined with. */
const SHINE_GLSL_SOURCE = /*#__PURE__*/ withSetGlsl(SHINE_GLSL);

/**
 * A band of light across a view: `position` is where the band stands along its sweep, -0.5 before the view and 1.5 past
 * it, so a tween from one to the other sweeps it across once; `width` is how far from its line the band reaches (0..1
 * of the sweep), `angle` its direction in radians in the view's own 0..1 frame, `strength` how much light it adds. Light
 * is added to the colour only: the transparent pixels around the view's shape stay transparent. For a glint on a
 * reward, a card, a button. List it in a feature's `filters`, as a game's own filter. One render pass, one sample; on
 * WebGPU a tween draws on the view's own quad, no pass, from its third frame.
 *
 * @example
 * ```ts
 * // A new reward glints once: the band sweeps across it in half a second.
 * Shine().value.position; // -0.5
 * view.tween(Shine, { position: 1.5 }, { ms: 500 });
 * ```
 */
export const Shine: FilterComponent<ShineValue> = /*#__PURE__*/ defineFilter("effects.shine", {
  wgsl: SHINE_SOURCE,
  glsl: SHINE_GLSL_SOURCE,
  uniforms: { position: -0.5, width: 0.2, angle: 0.6, strength: 0.6 }
});
