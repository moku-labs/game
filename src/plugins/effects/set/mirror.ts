/**
 * @file effects/set — `Mirror`: a view flipped in place, top to bottom or left to right, fading away from its mirror
 * line, for a reflection on a copy of a view. One pass, one sample of the input; on WebGPU a value change rides the
 * quad of stage 2 from its third write.
 */
import { defineFilter } from "../filters/define";
import type { FilterComponent } from "../filters/types";
import { withSetGlsl, withSetWgsl } from "./head";
import type { MirrorValue } from "./types";

/**
 * The WGSL body of `Mirror`. `axis` (read as `step(0.5, axis)`) picks the flip: 1 reads the place `(x, 1 − y)`, top to
 * bottom; 0 reads `(1 − x, y)`, left to right. `t` is the distance from the mirror line as a share of the view: `y`
 * from the top edge, `x` from the left one. A `fade` above 0 eases the picture out by `smoothstep(0, fade, t)`, gone
 * at `t ≥ fade` (an edge of at least 1e-4: two equal edges of `smoothstep` are undefined); a `fade` of 0 or less
 * (`fading` 0) keeps it whole. `alpha`, clamped to 0..1, multiplies the premultiplied pixel.
 */
export const MIRROR_WGSL = /* wgsl */ `@fragment
fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let n = inputPlace(uv);
  let a = step(0.5, fu.axis);
  let q = vec2<f32>(mix(1.0 - n.x, n.x, a), mix(n.y, 1.0 - n.y, a));
  let t = mix(n.x, n.y, a);
  let fading = 1.0 - step(fu.fade, 0.0);
  let keep = 1.0 - fading * smoothstep(0.0, max(fu.fade, 1e-4), t);

  return sampleInput(q) * (clamp(fu.alpha, 0.0, 1.0) * keep);
}
`;

/** The GLSL twin of `MIRROR_WGSL`. */
export const MIRROR_GLSL = /* glsl */ `void main() {
  vec2 n = inputPlace(vTextureCoord);
  float a = step(0.5, axis);
  vec2 q = vec2(mix(1.0 - n.x, n.x, a), mix(n.y, 1.0 - n.y, a));
  float t = mix(n.x, n.y, a);
  float fading = 1.0 - step(fade, 0.0);
  float keep = 1.0 - fading * smoothstep(0.0, max(fade, 1e-4), t);

  finalColor = sampleInput(q) * (clamp(alpha, 0.0, 1.0) * keep);
}
`;

/** The whole WGSL `Mirror` is defined with: the set head, then the body. */
const MIRROR_SOURCE = /*#__PURE__*/ withSetWgsl(MIRROR_WGSL);

/** The whole GLSL `Mirror` is defined with. */
const MIRROR_GLSL_SOURCE = /*#__PURE__*/ withSetGlsl(MIRROR_GLSL);

/**
 * A view flipped in place: `axis: 1` top to bottom, `axis: 0` left to right, as `Fold`'s axes. `alpha` (0..1) fades
 * it; `fade` above 0 eases it out to nothing at that share of the view from its mirror line, the top edge for axis 1
 * and the left edge for axis 0; 0 keeps it whole. It draws inside its own view, no padding: put it on a copy of a view
 * placed under the original for a reflection on a floor or water. List it in a feature's `filters`, as a game's own
 * filter. One render pass, one sample; on WebGPU a tween draws on the view's own quad, no pass, from its third frame.
 *
 * @example
 * ```ts
 * // The copy of a vase under it is its reflection on the polished floor, gone at half its height.
 * Mirror({ alpha: 0.4, fade: 0.5 }).value.axis; // 1
 * view.tween(Mirror, { alpha: 0 }, { ms: 300 });
 * ```
 */
export const Mirror: FilterComponent<MirrorValue> = /*#__PURE__*/ defineFilter("effects.mirror", {
  wgsl: MIRROR_SOURCE,
  glsl: MIRROR_GLSL_SOURCE,
  uniforms: { axis: 1, alpha: 1, fade: 0 }
});
