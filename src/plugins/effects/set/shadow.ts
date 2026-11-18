/**
 * @file effects/set — `Shadow`: a soft drop shadow of one colour under the shape of a view. One pass, 10 samples of
 * the input, padded by 8 px; on WebGPU a value change rides the quad of stage 2 from its third write.
 */
import { defineFilter } from "../filters/define";
import type { FilterComponent } from "../filters/types";
import { withSetGlsl, withSetWgsl } from "./head";
import type { ShadowValue } from "./types";

/**
 * The WGSL body of `Shadow`. Its reach is the definition's padding, `SHADOW_REACH` 8 CSS px: `soft` is clamped to
 * 0..8 (`radius`) and each of `x`, `y` to the room the radius leaves, `8 − radius` either way, so the shadow never
 * reaches past the padded frame and is never cut at its edge. The shadow's alpha is the mean of 9 samples of the
 * input's alpha, at the pixel moved back by the offset (`off / inputFrame()`, CSS px to 0..1 of the frame, as `Aura`'s
 * ring) and on a ring of 8 around it at `radius`; times `alpha`, clamped to 0..1. It is drawn in `color` under the
 * source: where the source is opaque nothing shows. The 10th sample is the source itself.
 */
export const SHADOW_WGSL = /* wgsl */ `const SHADOW_TAU: f32 = 6.283185307179586;
const SHADOW_REACH: f32 = 8.0;

@fragment
fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let n = inputPlace(uv);
  let c = sampleInput(n);
  let f = inputFrame();
  let radius = clamp(fu.soft, 0.0, SHADOW_REACH);
  let room = SHADOW_REACH - radius;
  let off = vec2<f32>(clamp(fu.x, -room, room), clamp(fu.y, -room, room));
  let base = n - off / f;
  let reach = radius / f;
  var cover = sampleInput(base).a;

  for (var i = 0; i < 8; i++) {
    let turn = SHADOW_TAU * f32(i) / 8.0;
    cover += sampleInput(base + vec2<f32>(cos(turn), sin(turn)) * reach).a;
  }

  let shade = clamp(cover / 9.0 * fu.alpha, 0.0, 1.0);

  return c + vec4<f32>(fu.color * shade, shade) * (1.0 - c.a);
}
`;

/** The GLSL twin of `SHADOW_WGSL`. */
export const SHADOW_GLSL = /* glsl */ `const float SHADOW_TAU = 6.283185307179586;
const float SHADOW_REACH = 8.0;

void main() {
  vec2 n = inputPlace(vTextureCoord);
  vec4 c = sampleInput(n);
  vec2 f = inputFrame();
  float radius = clamp(soft, 0.0, SHADOW_REACH);
  float room = SHADOW_REACH - radius;
  vec2 off = vec2(clamp(x, -room, room), clamp(y, -room, room));
  vec2 base = n - off / f;
  vec2 reach = radius / f;
  float cover = sampleInput(base).a;

  for (int i = 0; i < 8; i++) {
    float turn = SHADOW_TAU * float(i) / 8.0;
    cover += sampleInput(base + vec2(cos(turn), sin(turn)) * reach).a;
  }

  float shade = clamp(cover / 9.0 * alpha, 0.0, 1.0);

  finalColor = c + vec4(color * shade, shade) * (1.0 - c.a);
}
`;

/** The whole WGSL `Shadow` is defined with: the set head, then the body. */
const SHADOW_SOURCE = /*#__PURE__*/ withSetWgsl(SHADOW_WGSL);

/** The whole GLSL `Shadow` is defined with. */
const SHADOW_GLSL_SOURCE = /*#__PURE__*/ withSetGlsl(SHADOW_GLSL);

/**
 * A drop shadow of `color` at `alpha` (0..1) under the shape of a view and its subtree, moved by `x`, `y` CSS px and
 * blurred `soft` CSS px wide; the view is drawn over it. The view is padded by 8 px, the shadow's reach: `soft` is at
 * most 8, and `x` and `y` are clamped so `|x| + soft` and `|y| + soft` stay within 8. 9 samples of the shape on a
 * ring, where a blurred copy takes a chain, so a wide `soft` bands a little. For a card lifted off the table, a piece being dragged. List it
 * in a feature's `filters`, as a game's own filter. One render pass; on WebGPU a tween draws on the view's own quad,
 * no pass, from its third frame.
 *
 * @example
 * ```ts
 * // A picked card lifts: its shadow drops further and softens.
 * Shadow().value.y; // 4
 * Shadow.filter.padding; // 8
 * view.tween(Shadow, { y: 5, soft: 3 }, { ms: 160 });
 * ```
 */
export const Shadow: FilterComponent<ShadowValue> = /*#__PURE__*/ defineFilter("effects.shadow", {
  wgsl: SHADOW_SOURCE,
  glsl: SHADOW_GLSL_SOURCE,
  uniforms: { x: 0, y: 4, soft: 4, color: { color: 0x00_00_00 }, alpha: 0.5 },
  padding: 8
});
