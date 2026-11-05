/**
 * @file effects/set — `Dissolve`: a view eaten away by a noise, a coloured rim on the edge of what is left. One pass, one
 * sample of the input; on WebGPU a value change rides the quad of stage 2 from its third write.
 */
import { defineFilter } from "../filters/define";
import type { FilterComponent } from "../filters/types";
import { withSetGlsl, withSetWgsl } from "./head";
import type { DissolveValue } from "./types";

/**
 * The WGSL body of `Dissolve`. A value noise, no time: the head's integer hash at the four cells around the pixel's
 * place times `scale` (at least 1), mixed with smoothstep weights, so the grain is continuous and a pixel a hair off on
 * another backend moves its colour by a hair, never across a hard edge. The edge `e` runs from `-edge` to `1 + edge`
 * with `progress` (clamped to 0..1): 0 keeps every pixel untinted, 1 none. A pixel fades out over `edge` of grain under
 * `e`, and is tinted `edgeColor` at its own alpha over `edge` above it (`edge` at least 1e-4).
 */
export const DISSOLVE_WGSL = /* wgsl */ `@fragment
fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let n = inputPlace(uv);
  let c = sampleInput(n);
  let g = n * max(fu.scale, 1.0);
  let cell = floor(g);
  let w = smoothstep(vec2<f32>(0.0), vec2<f32>(1.0), fract(g));
  let top = mix(setHash(cell), setHash(cell + vec2<f32>(1.0, 0.0)), w.x);
  let bottom = mix(setHash(cell + vec2<f32>(0.0, 1.0)), setHash(cell + vec2<f32>(1.0, 1.0)), w.x);
  let grain = mix(top, bottom, w.y);
  let rim = max(fu.edge, 1e-4);
  let e = mix(-rim, 1.0 + rim, clamp(fu.progress, 0.0, 1.0));
  let keep = smoothstep(e - rim, e, grain);
  let glow = 1.0 - smoothstep(e, e + rim, grain);

  return vec4<f32>(mix(c.rgb, fu.edgeColor * c.a, glow), c.a) * keep;
}
`;

/** The GLSL twin of `DISSOLVE_WGSL`. */
export const DISSOLVE_GLSL = /* glsl */ `void main() {
  vec2 n = inputPlace(vTextureCoord);
  vec4 c = sampleInput(n);
  vec2 g = n * max(scale, 1.0);
  vec2 cell = floor(g);
  vec2 w = smoothstep(vec2(0.0), vec2(1.0), fract(g));
  float top = mix(setHash(cell), setHash(cell + vec2(1.0, 0.0)), w.x);
  float bottom = mix(setHash(cell + vec2(0.0, 1.0)), setHash(cell + vec2(1.0, 1.0)), w.x);
  float grain = mix(top, bottom, w.y);
  float rim = max(edge, 1e-4);
  float e = mix(-rim, 1.0 + rim, clamp(progress, 0.0, 1.0));
  float keep = smoothstep(e - rim, e, grain);
  float glow = 1.0 - smoothstep(e, e + rim, grain);

  finalColor = vec4(mix(c.rgb, edgeColor * c.a, glow), c.a) * keep;
}
`;

/** The whole WGSL `Dissolve` is defined with: the set head, then the body. */
const DISSOLVE_SOURCE = /*#__PURE__*/ withSetWgsl(DISSOLVE_WGSL);

/** The whole GLSL `Dissolve` is defined with. */
const DISSOLVE_GLSL_SOURCE = /*#__PURE__*/ withSetGlsl(DISSOLVE_GLSL);

/**
 * A view eaten away by a noise of `scale` cells across: `progress` 0 keeps all of it, 1 none, and the edge of what is
 * left glows in `edgeColor` over `edge` (0..1 of the noise). The noise has no time: the same cells go first at every
 * run, on WebGPU and WebGL alike. For a piece that burns away, a card that crumbles. List it in a feature's
 * `filters`, as a game's own filter. One render pass, one sample of the input; on WebGPU a tween draws on the view's
 * own quad, no pass, from its third frame.
 *
 * @example
 * ```ts
 * // A cleared piece burns away with a white rim.
 * Dissolve({ progress: 0.5 }).value.edge; // 0.08
 * view.tween(Dissolve, { progress: 1 }, { ms: 600 });
 * ```
 */
export const Dissolve: FilterComponent<DissolveValue> = /*#__PURE__*/ defineFilter(
  "effects.dissolve",
  {
    wgsl: DISSOLVE_SOURCE,
    glsl: DISSOLVE_GLSL_SOURCE,
    uniforms: { progress: 0, scale: 8, edge: 0.08, edgeColor: { color: 0xff_ff_ff } }
  }
);
