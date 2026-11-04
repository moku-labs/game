/**
 * @file effects/set — the values of the members of the engine's effect set: one field per uniform, then `enabled` and
 * `order`, which every filter component carries. A number field is tweenable; a colour is a `0xrrggbb` number, set,
 * not tweened.
 */

/**
 * `Flash`: the view washed with `color` by `amount`, 0 none, 1 all of it.
 *
 * @example
 * ```ts
 * const value: FlashValue = { amount: 1, color: 0xffd700, enabled: true, order: 0 };
 * ```
 */
export type FlashValue = {
  amount: number;
  color: number;
  enabled: boolean;
  order: number;
};

/**
 * `Grade`: contrast, brightness and saturation of the view, each 1 for none (0..2), then a multiply by `tint`.
 *
 * @example
 * ```ts
 * const value: GradeValue = { brightness: 1, contrast: 1, saturation: 0, tint: 0xffffff, enabled: true, order: 0 };
 * ```
 */
export type GradeValue = {
  brightness: number;
  contrast: number;
  saturation: number;
  tint: number;
  enabled: boolean;
  order: number;
};

/**
 * `Vignette`: the view darkened, or coloured, outside a disc around `x`, `y` (0..1 of the view) of `radius`, over a soft
 * edge `soft` wide, by `amount`.
 *
 * @example
 * ```ts
 * const value: VignetteValue = { x: 0.5, y: 0.5, radius: 0.3, soft: 0.4, color: 0x000000, amount: 1, enabled: true, order: 0 };
 * ```
 */
export type VignetteValue = {
  x: number;
  y: number;
  radius: number;
  soft: number;
  color: number;
  amount: number;
  enabled: boolean;
  order: number;
};
