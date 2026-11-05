/**
 * @file effects/set — `Aura`: a soft halo of one colour around the shape of a view. One pass, 13 samples of the input,
 * padded by its live `spread`; on WebGPU a value change rides the quad of stage 2 from its third write.
 */
import { defineFilter } from "../filters/define";
import type { FilterComponent } from "../filters/types";
import { withSetGlsl, withSetWgsl } from "./head";
import type { AuraValue } from "./types";

/**
 * The WGSL body of `Aura`, the loop of `Outline` on 12 spokes. The probes stand on a ring of `spread` CSS px around the
 * pixel: `spread / inputFrame()` is that radius in 0..1 of the padded frame, the same step as mapping the place into the
 * content box (`inner = (n × S − P) / (S − 2P)`, P the padding `spread`), moving it `spread` px, and mapping it back. The
 * mean alpha of the ring is a half next to a straight edge and falls to 0 at `spread` away; `smoothstep(0, 0.5, mean)`
 * turns that into the halo, times `strength` (at least 0) and clamped to 1. The halo is drawn in `color` under the
 * source: where the source is opaque nothing shows.
 */
export const AURA_WGSL = /* wgsl */ `const AURA_TAU: f32 = 6.283185307179586;

@fragment
fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let n = inputPlace(uv);
  let c = sampleInput(n);
  let reach = fu.spread / inputFrame();
  var ring = 0.0;

  for (var i = 0; i < 12; i++) {
    let turn = AURA_TAU * f32(i) / 12.0;
    ring += sampleInput(n + vec2<f32>(cos(turn), sin(turn)) * reach).a;
  }

  let halo = min(smoothstep(0.0, 0.5, ring / 12.0) * max(fu.strength, 0.0), 1.0);

  return c + vec4<f32>(fu.color * halo, halo) * (1.0 - c.a);
}
`;

/** The GLSL twin of `AURA_WGSL`. */
export const AURA_GLSL = /* glsl */ `const float AURA_TAU = 6.283185307179586;

void main() {
  vec2 n = inputPlace(vTextureCoord);
  vec4 c = sampleInput(n);
  vec2 reach = spread / inputFrame();
  float ring = 0.0;

  for (int i = 0; i < 12; i++) {
    float turn = AURA_TAU * float(i) / 12.0;
    ring += sampleInput(n + vec2(cos(turn), sin(turn)) * reach).a;
  }

  float halo = min(smoothstep(0.0, 0.5, ring / 12.0) * max(strength, 0.0), 1.0);

  finalColor = c + vec4(color * halo, halo) * (1.0 - c.a);
}
`;

/** The whole WGSL `Aura` is defined with: the set head, then the body. */
const AURA_SOURCE = /*#__PURE__*/ withSetWgsl(AURA_WGSL);

/** The whole GLSL `Aura` is defined with. */
const AURA_GLSL_SOURCE = /*#__PURE__*/ withSetGlsl(AURA_GLSL);

/**
 * A soft halo of `color` around the shape of a view and its subtree, `spread` CSS px wide and as strong as `strength`
 * (0..2; 1 is full next to a straight edge, 2 widens the full part). The view is padded by its live `spread`, so the
 * halo has room. A cheap glow: 13 samples where `Glow` takes 64 to 256, so it bands a little where `Glow` is smooth.
 * For a picked tile, a hint, a selected card. List it in a feature's `filters`, as a game's own filter. One render
 * pass; on WebGPU a tween of `strength` draws on the view's own quad, no pass, from its third frame.
 *
 * @example
 * ```ts
 * // A hinted tile glows gold, twelve pixels wide; the view is padded by the live spread.
 * Aura({ color: 0xffd700, spread: 12 }).value.spread; // 12
 * Aura.filter.padding; // "spread"
 * view.tween(Aura, { strength: 0 }, { ms: 300 });
 * ```
 */
export const Aura: FilterComponent<AuraValue> = /*#__PURE__*/ defineFilter("effects.aura", {
  wgsl: AURA_SOURCE,
  glsl: AURA_GLSL_SOURCE,
  uniforms: { color: { color: 0xff_ff_ff }, strength: 1, spread: 8 },
  padding: "spread"
});
