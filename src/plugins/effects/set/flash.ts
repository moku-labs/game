/**
 * @file effects/set — `Flash`: the view washed with one colour. One pass, one sample of the input; on WebGPU a value
 * change rides the quad of stage 2 from its third write.
 */
import { defineFilter } from "../filters/define";
import type { FilterComponent } from "../filters/types";
import { SET_GLSL, SET_WGSL } from "./head";
import type { FlashValue } from "./types";

/**
 * The WGSL body of `Flash`: the premultiplied input mixed towards `color` at the input's own alpha, by `amount`
 * clamped to 0..1, so a transparent pixel stays transparent and an overshooting tween does not burn.
 */
export const FLASH_WGSL = /* wgsl */ `@fragment
fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let c = sampleInput(inputPlace(uv));

  return mix(c, vec4<f32>(fu.color * c.a, c.a), clamp(fu.amount, 0.0, 1.0));
}
`;

/** The GLSL twin of `FLASH_WGSL`. */
export const FLASH_GLSL = /* glsl */ `void main() {
  vec4 c = sampleInput(inputPlace(vTextureCoord));

  finalColor = mix(c, vec4(color * c.a, c.a), clamp(amount, 0.0, 1.0));
}
`;

/** The whole WGSL `Flash` is defined with: the set head, then the body. */
const FLASH_SOURCE = SET_WGSL + FLASH_WGSL;

/** The whole GLSL `Flash` is defined with. */
const FLASH_GLSL_SOURCE = SET_GLSL + FLASH_GLSL;

/**
 * A view washed with `color` by `amount`: 0 draws the view as it is, 1 draws its shape in `color`, its alpha kept.
 * For a hit, a pick, a merge: tween `amount` up and down. List it in a feature's `filters`, as a game's own filter.
 * One render pass, one sample; on WebGPU a tween draws on the view's own quad, no pass, from its third frame.
 *
 * @example
 * ```ts
 * // features/board/feature.ts lists it: filters: [Flash]. A merged piece flashes gold, then a motion fades it out.
 * Flash({ amount: 1, color: 0xffd700 }).value; // { amount: 1, color: 0xffd700, enabled: true, order: 0 }
 * view.tween(Flash, { amount: 0 }, { ms: 160 });
 * ```
 */
export const Flash: FilterComponent<FlashValue> = /*#__PURE__*/ defineFilter("effects.flash", {
  wgsl: FLASH_SOURCE,
  glsl: FLASH_GLSL_SOURCE,
  uniforms: { amount: 0, color: { color: 0xff_ff_ff } }
});
