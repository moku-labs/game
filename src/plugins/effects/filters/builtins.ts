/**
 * @file effects/filters — the seven built-in filter components: `Glow` and `Outline` over our
 * WGSL and its GLSL twin, `Blur`, `ColorMatrix`, `Noise`, `Displacement` and `Alpha` over Pixi's
 * core filters, which ship both. The plugin registers them before any feature, in this order. No
 * `pixi-filters` dependency.
 */
import { component } from "../../world/ecs/define";
import { defineFilter } from "./define";
import { GLOW_GLSL } from "./glow-glsl";
import { GLOW_WGSL } from "./glow-wgsl";
import { OUTLINE_GLSL } from "./outline-glsl";
import { OUTLINE_WGSL } from "./outline-wgsl";
import type {
  AlphaValue,
  BlurValue,
  ColorMatrixValue,
  DisplacementValue,
  FilterComponent,
  GlowValue,
  KindEntry,
  NoiseValue,
  OutlineValue
} from "./types";

const blurDefaults: BlurValue = {
  strength: 8,
  quality: 0,
  resolution: 0,
  repeatEdgePixels: true,
  enabled: true,
  order: 0
};

const colorMatrixDefaults: ColorMatrixValue = {
  brightness: 1,
  saturation: 0,
  contrast: 0,
  hue: 0,
  grayscale: 0,
  enabled: true,
  order: 0
};

const noiseDefaults: NoiseValue = { amount: 0.5, seed: 0, enabled: true, order: 0 };

const displacementDefaults: DisplacementValue = {
  map: "",
  scaleX: 20,
  scaleY: 20,
  enabled: true,
  order: 0
};

const alphaDefaults: AlphaValue = { alpha: 1, enabled: true, order: 0 };

/**
 * A soft halo of `color` around the opaque pixels of a view and its subtree, `distance` pixels
 * wide, that follows the shape: rounded corners stay rounded. Its alpha is
 * `strength × alpha ×` the share of the disc of radius `distance` around the pixel the view
 * covers, so `strength: 2` is full next to a straight edge and fades to nothing at `distance`.
 * The view is padded by its live `distance`. One render pass per apply.
 *
 * @example
 * ```ts
 * // A merged item glows, and a motion hook tweens the glow away.
 * Glow({ strength: 4 }).value; // { strength: 4, distance: 10, color: 0xffffff, alpha: 1, enabled: true, order: 0 }
 * view.tween(Glow, { strength: 0 }, { ms: 200 });
 * ```
 */
export const Glow: FilterComponent<GlowValue> = /*#__PURE__*/ defineFilter("effects.glow", {
  wgsl: GLOW_WGSL,
  glsl: GLOW_GLSL,
  uniforms: { strength: 2, distance: 10, color: { color: 0xff_ff_ff }, alpha: 1 },
  padding: "distance"
});

/**
 * A ring of `thickness` pixels in `color` around the opaque pixels of a view and its subtree; the
 * view is padded by its live `thickness`. One render pass per apply.
 *
 * @example
 * ```ts
 * // The selected card is outlined in honey.
 * Outline({ thickness: 4, color: 0xffc233 }).value; // { thickness: 4, color: 0xffc233, alpha: 1, enabled: true, order: 0 }
 * ```
 */
export const Outline: FilterComponent<OutlineValue> = /*#__PURE__*/ defineFilter(
  "effects.outline",
  {
    wgsl: OUTLINE_WGSL,
    glsl: OUTLINE_GLSL,
    uniforms: { thickness: 2, color: { color: 0x00_00_00 }, alpha: 1 },
    padding: "thickness"
  }
);

/**
 * Pixi's blur over a view and its subtree. `quality: 0` means `config.blur.quality`;
 * `resolution: 0` means `config.blur.phoneResolution` on a phone, otherwise 1. `repeatEdgePixels`
 * keeps the padding at 0. Costs `2 × quality` render passes per apply.
 *
 * @example
 * ```ts
 * // The board behind a popup: the filter sits on the ui slot that hosts the board.
 * Blur({ strength: 6 }).value; // { strength: 6, quality: 0, resolution: 0, repeatEdgePixels: true, enabled: true, order: 0 }
 * ```
 */
export const Blur = /*#__PURE__*/ component("effects.blur", blurDefaults);

/**
 * Pixi's colour matrix: brightness, saturation, contrast, hue in degrees and grayscale, composed
 * in that order from the identity on every change. Every default is the identity.
 *
 * @example
 * ```ts
 * // A locked card goes gray.
 * ColorMatrix({ grayscale: 1 }).value.grayscale; // 1
 * ```
 */
export const ColorMatrix = /*#__PURE__*/ component("effects.colorMatrix", colorMatrixDefaults);

/**
 * Pixi's noise. The seed is always given, never Pixi's random default, so two runs draw the same
 * grain.
 *
 * @example
 * ```ts
 * Noise({ amount: 0.2, seed: 7 }).value; // { amount: 0.2, seed: 7, enabled: true, order: 0 }
 * ```
 */
export const Noise = /*#__PURE__*/ component("effects.noise", noiseDefaults);

/**
 * Pixi's displacement over the texture of the asset key `map`. Nothing is drawn while the map is
 * not loaded; a missing key warns once.
 *
 * @example
 * ```ts
 * // Heat haze over the furnace.
 * Displacement({ map: "fx.ripple", scaleX: 8, scaleY: 8 }).value.map; // "fx.ripple"
 * ```
 */
export const Displacement = /*#__PURE__*/ component("effects.displacement", displacementDefaults);

/**
 * Pixi's alpha over a view and its subtree as one layer, so overlapping children do not show
 * through each other.
 *
 * @example
 * ```ts
 * Alpha({ alpha: 0.5 }).value; // { alpha: 0.5, enabled: true, order: 0 }
 * ```
 */
export const Alpha = /*#__PURE__*/ component("effects.alpha", alphaDefaults);

/**
 * The built-in kinds in registration order: ours first, then the Pixi-core kinds.
 *
 * @returns The seven kinds, before they are numbered.
 * @example
 * ```ts
 * builtInKinds().map(kind => kind.id)[0]; // "effects.glow"
 * ```
 */
export function builtInKinds(): readonly KindEntry[] {
  return [
    { id: Glow.filter.id, component: Glow, source: "wgsl", definition: Glow.filter },
    { id: Outline.filter.id, component: Outline, source: "wgsl", definition: Outline.filter },
    { id: Blur.componentName, component: Blur, source: "core", core: "blur" },
    { id: ColorMatrix.componentName, component: ColorMatrix, source: "core", core: "colorMatrix" },
    { id: Noise.componentName, component: Noise, source: "core", core: "noise" },
    {
      id: Displacement.componentName,
      component: Displacement,
      source: "core",
      core: "displacement"
    },
    { id: Alpha.componentName, component: Alpha, source: "core", core: "alpha" }
  ];
}
