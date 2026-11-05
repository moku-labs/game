/**
 * @file effects/set — `RevealLine`: a view shown up to a straight line that sweeps across it. One pass, one sample of
 * the input; on WebGPU a value change rides the quad of stage 2 from its third write.
 */
import { defineFilter } from "../filters/define";
import type { FilterComponent } from "../filters/types";
import { withSetGlsl, withSetWgsl } from "./head";
import type { RevealLineValue } from "./types";

/**
 * The WGSL body of `RevealLine`. `p` is where the pixel stands along the direction `angle`, 0 at the first corner the
 * line meets and 1 at the last: `reach`, half the view's extent along the direction, keeps every corner in 0..1 at any
 * angle. The line's place `e` runs from `-soft` to `1 + soft` with `progress` (clamped to 0..1), so 0 shows nothing and 1
 * all of it, and the pixel fades out over `soft` on each side of it (at least 1e-4: `smoothstep` of two equal edges is
 * undefined). The premultiplied input is scaled as a whole: the shown part is drawn as it is.
 */
export const REVEAL_LINE_WGSL = /* wgsl */ `@fragment
fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let n = inputPlace(uv);
  let c = sampleInput(n);
  let dir = vec2<f32>(cos(fu.angle), sin(fu.angle));
  let reach = 0.5 * (abs(dir.x) + abs(dir.y));
  let p = ((n.x - 0.5) * dir.x + (n.y - 0.5) * dir.y + reach) / (2.0 * reach);
  let fade = max(fu.soft, 1e-4);
  let e = mix(-fade, 1.0 + fade, clamp(fu.progress, 0.0, 1.0));

  return c * (1.0 - smoothstep(e - fade, e + fade, p));
}
`;

/** The GLSL twin of `REVEAL_LINE_WGSL`. */
export const REVEAL_LINE_GLSL = /* glsl */ `void main() {
  vec2 n = inputPlace(vTextureCoord);
  vec4 c = sampleInput(n);
  vec2 dir = vec2(cos(angle), sin(angle));
  float reach = 0.5 * (abs(dir.x) + abs(dir.y));
  float p = ((n.x - 0.5) * dir.x + (n.y - 0.5) * dir.y + reach) / (2.0 * reach);
  float fade = max(soft, 1e-4);
  float e = mix(-fade, 1.0 + fade, clamp(progress, 0.0, 1.0));

  finalColor = c * (1.0 - smoothstep(e - fade, e + fade, p));
}
`;

/** The whole WGSL `RevealLine` is defined with: the set head, then the body. */
const REVEAL_LINE_SOURCE = /*#__PURE__*/ withSetWgsl(REVEAL_LINE_WGSL);

/** The whole GLSL `RevealLine` is defined with. */
const REVEAL_LINE_GLSL_SOURCE = /*#__PURE__*/ withSetGlsl(REVEAL_LINE_GLSL);

/**
 * A view shown up to a straight line that sweeps across it: `progress` 0 hides all of it, 1 shows all of it, the line
 * at `angle` radians (0 sweeps from the left, `Math.PI / 2` from the top) with an edge `soft` wide. The angle is in the
 * view's own 0..1 frame, so `Math.PI / 4` sweeps from one corner to the opposite one on a view of any shape. For a wipe
 * in or out of a card, a panel, a picture. List it in a feature's `filters`, as a game's own filter. One render pass,
 * one sample; on WebGPU a tween draws on the view's own quad, no pass, from its third frame.
 *
 * @example
 * ```ts
 * // A level card wipes in from the top: it starts hidden, and a motion tweens progress to 1.
 * RevealLine({ angle: Math.PI / 2 }).value.progress; // 0
 * view.tween(RevealLine, { progress: 1 }, { ms: 400 });
 * ```
 */
export const RevealLine: FilterComponent<RevealLineValue> = /*#__PURE__*/ defineFilter(
  "effects.revealLine",
  {
    wgsl: REVEAL_LINE_SOURCE,
    glsl: REVEAL_LINE_GLSL_SOURCE,
    uniforms: { progress: 0, angle: 0, soft: 0.05 }
  }
);
