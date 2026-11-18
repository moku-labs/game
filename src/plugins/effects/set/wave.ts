/**
 * @file effects/set — `Wave`: a view swaying in a sine wave, rows or columns moved along it. One pass, one sample of
 * the input; on WebGPU a value change rides the quad of stage 2 from its third write.
 */
import { defineFilter } from "../filters/define";
import type { FilterComponent } from "../filters/types";
import { withSetGlsl, withSetWgsl } from "./head";
import type { WaveValue } from "./types";

/**
 * The WGSL body of `Wave`, in CSS px of the frame (`n × inputFrame()`). `dir`, at `angle`, is the way the picture
 * sways; `along` is the place across it, `dot(px, (−sin angle, cos angle))`: at angle 0 the y of a row, which sways in
 * x; at π/2 the −x of a column, which sways in y. The offset is `amplitude × sin(WAVE_TAU × along / wavelength +
 * phase)` (a wavelength of at least 1 px); the pixel reads the place it came from, `px − dir × offset`, back in 0..1.
 * A source more than 1e-4 outside 0..1 on either axis (`away`) is transparent, not the edge smeared in: the margin
 * keeps the last row and column of a view at amplitude 0, whose place rounds a hair past 1. No time: a game tweens
 * `phase`.
 */
export const WAVE_WGSL = /* wgsl */ `const WAVE_TAU: f32 = 6.283185307179586;

@fragment
fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let n = inputPlace(uv);
  let f = inputFrame();
  let px = n * f;
  let dir = vec2<f32>(cos(fu.angle), sin(fu.angle));
  let along = dot(px, vec2<f32>(-dir.y, dir.x));
  let o = fu.amplitude * sin(WAVE_TAU * along / max(fu.wavelength, 1.0) + fu.phase);
  let q = (px - dir * o) / f;
  let away = max(abs(q.x - clamp(q.x, 0.0, 1.0)), abs(q.y - clamp(q.y, 0.0, 1.0)));
  let inside = step(away, 1e-4);

  return sampleInput(q) * inside;
}
`;

/** The GLSL twin of `WAVE_WGSL`. */
export const WAVE_GLSL = /* glsl */ `const float WAVE_TAU = 6.283185307179586;

void main() {
  vec2 n = inputPlace(vTextureCoord);
  vec2 f = inputFrame();
  vec2 px = n * f;
  vec2 dir = vec2(cos(angle), sin(angle));
  float along = dot(px, vec2(-dir.y, dir.x));
  float o = amplitude * sin(WAVE_TAU * along / max(wavelength, 1.0) + phase);
  vec2 q = (px - dir * o) / f;
  float away = max(abs(q.x - clamp(q.x, 0.0, 1.0)), abs(q.y - clamp(q.y, 0.0, 1.0)));
  float inside = step(away, 1e-4);

  finalColor = sampleInput(q) * inside;
}
`;

/** The whole WGSL `Wave` is defined with: the set head, then the body. */
const WAVE_SOURCE = /*#__PURE__*/ withSetWgsl(WAVE_WGSL);

/** The whole GLSL `Wave` is defined with. */
const WAVE_GLSL_SOURCE = /*#__PURE__*/ withSetGlsl(WAVE_GLSL);

/**
 * A view swaying in a sine wave: at `angle` 0 its rows move left and right, at `π / 2` its columns move up and down,
 * by up to `amplitude` CSS px, one wave every `wavelength` CSS px, shifted by `phase` (radians). What would come from
 * outside the view is transparent. There is no time in the shader: a tween of `phase` by a full turn, repeated, makes
 * it flow. For water, heat, a dream. List it in a feature's `filters`, as a game's own filter. One render pass, one
 * sample; on WebGPU a tween draws on the view's own quad, no pass, from its third frame.
 *
 * @example
 * ```ts
 * // A reflection in a pond ripples for as long as the scene is open.
 * Wave({ amplitude: 3 }).value.wavelength; // 48
 * view.tween(Wave, { phase: Math.PI * 2 }, { ms: 1200, ease: "linear", repeat: "forever" });
 * ```
 */
export const Wave: FilterComponent<WaveValue> = /*#__PURE__*/ defineFilter("effects.wave", {
  wgsl: WAVE_SOURCE,
  glsl: WAVE_GLSL_SOURCE,
  uniforms: { amplitude: 4, wavelength: 48, phase: 0, angle: 0 }
});
