/**
 * @file effects/set — `Fold`: a view turned about one of its axes, as a card flips, its far side shrinking away and its
 * back in shade. One pass, one sample of the input, padded by 8 px; on WebGPU a value change rides the quad of stage 2
 * from its third write.
 */
import { defineFilter } from "../filters/define";
import type { FilterComponent } from "../filters/types";
import { withSetGlsl, withSetWgsl } from "./head";
import type { FoldValue } from "./types";

/**
 * The WGSL body of `Fold`, the shape of the bench's `RowFlip` over the content box. The place in the padded frame maps
 * to the content box, `q = (n × S − P) / (S − 2P)` with `S = inputFrame()` and `P = FOLD_PADDING`, the definition's
 * padding of 8 CSS px. `axis` (0 or 1, read as `step(0.5, axis)`) picks the turned coordinate `u` and the other `v`.
 * Turned by `angle`, the content shrinks along `u` by `|cos angle|` (at least 0.02); along `v` the side that goes away
 * shrinks, by `1 − perspective × (|sin angle| / 2 − sin angle × (u − 0.5))`: the near edge keeps its size, so the turned
 * view never leaves its content box at any size or angle. Outside the turned content the pixel is transparent; inside
 * it reads the content back through the same map, and past a quarter turn the back is darkened to `1 − shade × −cos
 * angle`. At `angle: 0` it draws the view as it is.
 */
export const FOLD_WGSL = /* wgsl */ `const FOLD_PADDING: f32 = 8.0;

@fragment
fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let n = inputPlace(uv);
  let s = inputFrame();
  let q = (n * s - FOLD_PADDING) / (s - 2.0 * FOLD_PADDING);
  let a = step(0.5, fu.axis);
  let u = mix(q.x, q.y, a);
  let v = mix(q.y, q.x, a);
  let su = 0.5 + (u - 0.5) / max(abs(cos(fu.angle)), 0.02);
  let lean = 1.0 - clamp(fu.perspective, 0.0, 1.0) * (0.5 * abs(sin(fu.angle)) - sin(fu.angle) * (su - 0.5));
  let sv = 0.5 + (v - 0.5) / max(lean, 0.05);
  let place = mix(vec2<f32>(su, sv), vec2<f32>(sv, su), a);
  let inside = step(0.0, place.x) * step(place.x, 1.0) * step(0.0, place.y) * step(place.y, 1.0);
  let c = sampleInput((place * (s - 2.0 * FOLD_PADDING) + FOLD_PADDING) / s);
  let dark = 1.0 - clamp(fu.shade, 0.0, 1.0) * max(-cos(fu.angle), 0.0);

  return vec4<f32>(c.rgb * dark, c.a) * inside;
}
`;

/** The GLSL twin of `FOLD_WGSL`. */
export const FOLD_GLSL = /* glsl */ `const float FOLD_PADDING = 8.0;

void main() {
  vec2 n = inputPlace(vTextureCoord);
  vec2 s = inputFrame();
  vec2 q = (n * s - FOLD_PADDING) / (s - 2.0 * FOLD_PADDING);
  float a = step(0.5, axis);
  float u = mix(q.x, q.y, a);
  float v = mix(q.y, q.x, a);
  float su = 0.5 + (u - 0.5) / max(abs(cos(angle)), 0.02);
  float lean = 1.0 - clamp(perspective, 0.0, 1.0) * (0.5 * abs(sin(angle)) - sin(angle) * (su - 0.5));
  float sv = 0.5 + (v - 0.5) / max(lean, 0.05);
  vec2 place = mix(vec2(su, sv), vec2(sv, su), a);
  float inside = step(0.0, place.x) * step(place.x, 1.0) * step(0.0, place.y) * step(place.y, 1.0);
  vec4 c = sampleInput((place * (s - 2.0 * FOLD_PADDING) + FOLD_PADDING) / s);
  float dark = 1.0 - clamp(shade, 0.0, 1.0) * max(-cos(angle), 0.0);

  finalColor = vec4(c.rgb * dark, c.a) * inside;
}
`;

/** The whole WGSL `Fold` is defined with: the set head, then the body. */
const FOLD_SOURCE = /*#__PURE__*/ withSetWgsl(FOLD_WGSL);

/** The whole GLSL `Fold` is defined with. */
const FOLD_GLSL_SOURCE = /*#__PURE__*/ withSetGlsl(FOLD_GLSL);

/**
 * A view turned by `angle` radians about its vertical axis (`axis: 0`) or its horizontal one (`axis: 1`), as a card or
 * an order row flips: at a quarter turn it is edge-on, at a half turn it shows its back, unmirrored and darkened by
 * `shade` (0..1). `perspective` (0..1) leans it: the side that goes away shrinks, to `1 − perspective` of its height at
 * a quarter turn, while the near side keeps its size, so the view never grows past its box. The view is padded by 8 px.
 * For a card flip, a row that turns to its next order. List it in a feature's `filters`, as a game's own filter. One
 * render pass, one sample; on WebGPU a tween draws on the view's own quad, no pass, from its third frame.
 *
 * @example
 * ```ts
 * // An order row flips about its horizontal axis to show its next order.
 * Fold({ axis: 1 }).value.axis; // 1
 * view.tween(Fold, { angle: Math.PI }, { ms: 320 });
 * ```
 */
export const Fold: FilterComponent<FoldValue> = /*#__PURE__*/ defineFilter("effects.fold", {
  wgsl: FOLD_SOURCE,
  glsl: FOLD_GLSL_SOURCE,
  uniforms: { angle: 0, axis: 0, perspective: 0.5, shade: 0.4 },
  padding: 8
});
