/**
 * @file effects/set — `RevealRound`: a view shown inside a growing disc, its edge wavy if asked. One pass, one sample of
 * the input; on WebGPU a value change rides the quad of stage 2 from its third write.
 */
import { defineFilter } from "../filters/define";
import type { FilterComponent } from "../filters/types";
import { withSetGlsl, withSetWgsl } from "./head";
import type { RevealRoundValue } from "./types";

/**
 * The WGSL body of `RevealRound`: the distance of the pixel's place from `(x, y)`, in 0..1 of the view on each axis,
 * moved by `wobble × sin(37 x + 23 y)` (the fog's edge) and never below 0; the pixel shows inside `radius` and fades out
 * over the `soft` just inside it (at least 1e-4: `smoothstep` of two equal edges is undefined). So `radius: 0` hides
 * every pixel, also where the wobble would pull the distance under 0. The premultiplied input is scaled as a whole.
 */
export const REVEAL_ROUND_WGSL = /* wgsl */ `@fragment
fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let n = inputPlace(uv);
  let c = sampleInput(n);
  let wave = fu.wobble * sin(n.x * 37.0 + n.y * 23.0);
  let d = max(distance(n, vec2<f32>(fu.x, fu.y)) + wave, 0.0);
  let fade = max(fu.soft, 1e-4);

  return c * (1.0 - smoothstep(fu.radius - fade, fu.radius, d));
}
`;

/** The GLSL twin of `REVEAL_ROUND_WGSL`. */
export const REVEAL_ROUND_GLSL = /* glsl */ `void main() {
  vec2 n = inputPlace(vTextureCoord);
  vec4 c = sampleInput(n);
  float wave = wobble * sin(n.x * 37.0 + n.y * 23.0);
  float d = max(distance(n, vec2(x, y)) + wave, 0.0);
  float fade = max(soft, 1e-4);

  finalColor = c * (1.0 - smoothstep(radius - fade, radius, d));
}
`;

/** The whole WGSL `RevealRound` is defined with: the set head, then the body. */
const REVEAL_ROUND_SOURCE = /*#__PURE__*/ withSetWgsl(REVEAL_ROUND_WGSL);

/** The whole GLSL `RevealRound` is defined with. */
const REVEAL_ROUND_GLSL_SOURCE = /*#__PURE__*/ withSetGlsl(REVEAL_ROUND_GLSL);

/**
 * A view shown inside a disc around the point `x`, `y`: `radius: 0` hides all of it, and from about 0.75 a disc at the
 * centre shows every corner (1.5 shows all of it from any point). The edge fades over `soft` and waves by `wobble`
 * (0..0.2). The point and the lengths are in 0..1 of the view on each axis, so on a view twice as wide as tall the disc
 * is an ellipse. It hides the outside by alpha and declares no `area`: the view's fill is still paid. List it in a
 * feature's `filters`, as a game's own filter. One render pass, one sample; on WebGPU a tween draws on the view's own
 * quad, no pass, from its third frame.
 *
 * @example
 * ```ts
 * // A lens opens over the map: the window starts closed and grows to show the whole view.
 * spawn([Sprite({ texture: "map.ward" }), Transform(), RevealRound({ wobble: 0.04 })]);
 * view.tween(RevealRound, { radius: 1.2 }, { ms: 640 });
 * ```
 */
export const RevealRound: FilterComponent<RevealRoundValue> = /*#__PURE__*/ defineFilter(
  "effects.revealRound",
  {
    wgsl: REVEAL_ROUND_SOURCE,
    glsl: REVEAL_ROUND_GLSL_SOURCE,
    uniforms: { x: 0.5, y: 0.5, radius: 0, soft: 0.05, wobble: 0 }
  }
);
