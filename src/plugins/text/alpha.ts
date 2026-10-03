/**
 * @file text plugin — the alpha of a run in a distance-field font. Pixi 8.21 draws such a font with
 * a shader that multiplies the group alpha in twice: `calculateMSDFAlpha` (`mSDFBit`) raises
 * `vColor.a × coverage` to a gamma that leans on the luma of the premultiplied colour, and the
 * shader template multiplies that by `vColor` again. A run at alpha 0.5 so draws at about 0.25.
 * These two functions are that shader and its inverse, so the display hands Pixi the alpha that
 * draws at the alpha a `Text` asked for. Pure: the numbers are the shader's own.
 */

/** How far Pixi's gamma moves from 1 for a white glyph: `mix(1, 1 / 2.2, luma)`. */
const GAMMA_SPAN = 1 - 1 / 2.2;

/** Fixed-point steps of the inverse. Each one cuts the error about ninefold; six reach 1e-7. */
const SOLVE_STEPS = 6;

/**
 * The luma Pixi's MSDF shader weighs a colour with, from 0 for black to 1 for white.
 *
 * @param color - The colour as `0xrrggbb`.
 * @returns The luma.
 * @example
 * ```ts
 * lumaOf(0xff_ff_ff); // 1
 * ```
 */
function lumaOf(color: number): number {
  const red = (color >> 16) & 0xff;
  const green = (color >> 8) & 0xff;
  const blue = color & 0xff;

  return (0.299 * red + 0.587 * green + 0.114 * blue) / 255;
}

/**
 * How opaque Pixi 8.21 draws the inside of a distance-field glyph whose group alpha is `alpha`:
 * the alpha times the coverage `alpha ** gamma`, where the gamma is `mix(1, 1 / 2.2, luma × alpha)`.
 *
 * @param alpha - The group alpha of the glyph object, from 0 to 1.
 * @param color - The colour the glyph shows: its fill times its tint.
 * @returns The opacity on the screen, from 0 to 1.
 * @example
 * ```ts
 * msdfOpacity(0.5, 0x00_00_00); // 0.25
 * ```
 */
export function msdfOpacity(alpha: number, color: number): number {
  return alpha ** (2 - GAMMA_SPAN * lumaOf(color) * alpha);
}

/**
 * The group alpha to hand Pixi so a distance-field glyph in `color` draws at `opacity`: the inverse
 * of `msdfOpacity`, by fixed point from the square root, which is exact for black.
 *
 * @param opacity - The opacity wanted on the screen. Clamped to 0..1.
 * @param color - The colour the glyph shows: its fill times its tint.
 * @returns The group alpha, from 0 to 1.
 * @example
 * ```ts
 * msdfAlpha(0.25, 0x00_00_00); // 0.5
 * ```
 */
export function msdfAlpha(opacity: number, color: number): number {
  const target = Math.min(Math.max(opacity, 0), 1);
  const lift = GAMMA_SPAN * lumaOf(color);
  let alpha = Math.sqrt(target);

  for (let step = 0; step < SOLVE_STEPS; step += 1) alpha = target ** (1 / (2 - lift * alpha));

  return alpha;
}
