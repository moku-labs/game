/**
 * @file effects/filters — the dev-only mark drawn over a broken filter view, so it is never mistaken for a design
 * choice: diagonal magenta stripes 6 CSS px wide over the whole filter area of the view, visible on transparent
 * pixels too. Engine code with its own tests: not a registered kind, never checked.
 */
import { defineFilter } from "./define";
import type { FilterComponent } from "./types";

/** The WGSL body of the mark: the input with magenta stripes mixed in. */
const MARK_WGSL = /* wgsl */ `@fragment
fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let c = textureSampleLevel(uTexture, uSampler, uv, 0.0);
  let p = uv * gfu.uInputSize.xy;
  let stripe = step(0.5, fract((p.x + p.y) / 12.0));
  let magenta = vec4<f32>(1.0, 0.0, 1.0, 1.0) * max(c.a, 0.6);
  return mix(c, magenta, 0.45 * stripe);
}
`;

/** The GLSL twin of the mark: the same stripes, the same constants. */
const MARK_GLSL = /* glsl */ `void main() {
  vec4 c = texture(uTexture, vTextureCoord);
  vec2 p = vTextureCoord * uInputSize.xy;
  float stripe = step(0.5, fract((p.x + p.y) / 12.0));
  vec4 magenta = vec4(1.0, 0.0, 1.0, 1.0) * max(c.a, 0.6);
  finalColor = mix(c, magenta, 0.45 * stripe);
}
`;

/** The mark once it was made: built on the first call, so importing this file makes nothing. */
const made: { mark: FilterComponent<{ enabled: boolean; order: number }> | undefined } = {
  mark: undefined
};

/**
 * The striped magenta mark a dev build draws over a broken filter view: a `defineFilter("effects.broken-mark", …)`
 * made on the first call and cached. Not a registered kind, never checked; reached only under the inline
 * `__MOKU_GAME_DEV__` guard, so a release bundle drops it.
 *
 * @returns The mark's filter component.
 * @example
 * ```ts
 * brokenMark().filter.id; // "effects.broken-mark"
 * ```
 */
export function brokenMark(): FilterComponent<{ enabled: boolean; order: number }> {
  made.mark ??= defineFilter("effects.broken-mark", { wgsl: MARK_WGSL, glsl: MARK_GLSL });

  return made.mark;
}
