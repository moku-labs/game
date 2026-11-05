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

/**
 * `RevealLine`: the view shown up to a straight line that sweeps across it, `progress` 0 none of it, 1 all of it, the
 * line at `angle` (radians, in the view's own 0..1 frame), its edge `soft` wide.
 *
 * @example
 * ```ts
 * const value: RevealLineValue = { progress: 0.5, angle: Math.PI / 4, soft: 0.1, enabled: true, order: 0 };
 * ```
 */
export type RevealLineValue = {
  progress: number;
  angle: number;
  soft: number;
  enabled: boolean;
  order: number;
};

/**
 * `RevealRound`: the view shown inside a disc around `x`, `y` (0..1 of the view) of `radius`, its edge `soft` wide and
 * wavy by `wobble`.
 *
 * @example
 * ```ts
 * const value: RevealRoundValue = { x: 0.5, y: 0.5, radius: 1.2, soft: 0.05, wobble: 0.04, enabled: true, order: 0 };
 * ```
 */
export type RevealRoundValue = {
  x: number;
  y: number;
  radius: number;
  soft: number;
  wobble: number;
  enabled: boolean;
  order: number;
};

/**
 * `Dissolve`: the view eaten by a noise of `scale` cells across, `progress` 0 none of it, 1 all of it, the rim `edge`
 * wide in `edgeColor`.
 *
 * @example
 * ```ts
 * const value: DissolveValue = { progress: 0.5, scale: 8, edge: 0.08, edgeColor: 0xffffff, enabled: true, order: 0 };
 * ```
 */
export type DissolveValue = {
  progress: number;
  scale: number;
  edge: number;
  edgeColor: number;
  enabled: boolean;
  order: number;
};

/**
 * `Shine`: a band of light `width` wide at `position` of its sweep (-0.5..1.5), across the view at `angle`, by
 * `strength`.
 *
 * @example
 * ```ts
 * const value: ShineValue = { position: 0.5, width: 0.2, angle: 0.6, strength: 0.6, enabled: true, order: 0 };
 * ```
 */
export type ShineValue = {
  position: number;
  width: number;
  angle: number;
  strength: number;
  enabled: boolean;
  order: number;
};

/**
 * `Aura`: a halo of `color` by `strength` (0..2) around the shape of the view, `spread` CSS px wide, which is also the
 * view's padding.
 *
 * @example
 * ```ts
 * const value: AuraValue = { color: 0xffd700, strength: 1, spread: 12, enabled: true, order: 0 };
 * ```
 */
export type AuraValue = {
  color: number;
  strength: number;
  spread: number;
  enabled: boolean;
  order: number;
};

/**
 * `Fold`: the view turned by `angle` (radians) about its vertical axis (`axis: 0`) or its horizontal one (`axis: 1`),
 * leaning by `perspective` (0..1), its back darkened by `shade` (0..1).
 *
 * @example
 * ```ts
 * const value: FoldValue = { angle: Math.PI / 2, axis: 1, perspective: 0.5, shade: 0.4, enabled: true, order: 0 };
 * ```
 */
export type FoldValue = {
  angle: number;
  axis: number;
  perspective: number;
  shade: number;
  enabled: boolean;
  order: number;
};

/**
 * `Bloom`: light around the bright parts of the view: what is above `threshold` (0..1) of its light, blurred `radius`
 * CSS px wide and added back by `strength` (0..2).
 *
 * @example
 * ```ts
 * const value: BloomValue = { strength: 0.6, threshold: 0.7, radius: 16, enabled: true, order: 0 };
 * ```
 */
export type BloomValue = {
  strength: number;
  threshold: number;
  radius: number;
  enabled: boolean;
  order: number;
};
