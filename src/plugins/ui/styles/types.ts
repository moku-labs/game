/**
 * @file ui/styles — the style vocabulary, the two flag sets and the module shape. Pure types:
 * a style is plain data a game writes once and `resolve` turns into the frozen rect input.
 */
import type { ViewportSize } from "../../renderer/viewport/types";

/**
 * A length that may also come from the notch. The four tokens are replaced by `resolve` with the
 * matching `viewport.safeArea` value.
 *
 * @example
 * ```ts
 * const top: SafeAreaToken = "safeArea.top";
 * ```
 */
export type SafeAreaToken = "safeArea.top" | "safeArea.right" | "safeArea.bottom" | "safeArea.left";

/**
 * A length in reference units, or one of the safe-area tokens.
 *
 * @example
 * ```ts
 * const length: Length = 24;
 * ```
 */
export type Length = number | SafeAreaToken;

/**
 * Padding or margin: one number for every edge, or a value per edge.
 *
 * @example
 * ```ts
 * const padding: Edges = { top: "safeArea.top", left: 16 };
 * ```
 */
export type Edges = Length | { top?: Length; right?: Length; bottom?: Length; left?: Length };

/**
 * A main-axis or cross-axis size: reference units, a percent of the parent, or `"auto"`.
 *
 * @example
 * ```ts
 * const width: Extent = "50%";
 * ```
 */
export type Extent = number | `${number}%` | "auto";

/**
 * The flow group of the vocabulary: what Yoga's flexbox calls are set from.
 *
 * @example
 * ```ts
 * const flow: FlowStyle = { direction: "row", gap: 12, justify: "between" };
 * ```
 */
export type FlowStyle = {
  direction?: "row" | "column";
  wrap?: boolean;
  justify?: "start" | "center" | "end" | "between" | "around" | "evenly";
  align?: "start" | "center" | "end" | "stretch";
  alignSelf?: "auto" | "start" | "center" | "end" | "stretch";
  gap?: number;
  grow?: number;
  shrink?: number;
};

/**
 * The box group: what the element takes up before its children are placed.
 *
 * @example
 * ```ts
 * // The board slot: 970 u of cells, scaled down on a short phone.
 * const box: BoxStyle = { width: 970, height: 970, fit: "contain" };
 * ```
 */
export type BoxStyle = {
  padding?: Edges;
  margin?: Edges;
  width?: Extent;
  height?: Extent;
  minWidth?: Extent;
  minHeight?: Extent;
  maxWidth?: Extent;
  maxHeight?: Extent;
  aspect?: number;
  /** `"hidden"` clips the children to the rect, as a scroll container does. */
  overflow?: "visible" | "hidden" | "scroll";
  /**
   * `"contain"`: the element keeps its own size and leaves the flow, then is scaled down to fit
   * the content box of its parent and centred in it. Its children keep their natural rects.
   */
  fit?: "contain";
};

/**
 * The position group. `reason` is the comment `lint()` asks for next to an absolute element.
 *
 * @example
 * ```ts
 * const pinned: PositionStyle = { position: "absolute", top: 0, right: 0, reason: "badge" };
 * ```
 */
export type PositionStyle = {
  position?: "relative" | "absolute";
  left?: Length;
  top?: Length;
  right?: Length;
  bottom?: Length;
  reason?: string;
};

/**
 * The visual group: what is written to `Shape`, `Sprite` or `NineSlice`. There is no font size
 * here — the size of a text comes from its text style key.
 *
 * @example
 * ```ts
 * // A wooden button: the nine-slice of the style, greyed while disabled.
 * const visual: VisualStyle = { nineSlice: "ui.button-wood", alpha: 1, tint: 0xffffff };
 * ```
 */
export type VisualStyle<Asset extends string = string> = {
  fill?: number;
  stroke?: number;
  strokeWidth?: number;
  radius?: number;
  alpha?: number;
  /**
   * The asset key of a nine-slice drawn at the rect instead of the rounded rectangle. Any tag
   * but `image`, `icon` and `text` takes it; a clipping element (`scroll`, `overflow: "hidden"`)
   * keeps its rectangle, which carries the clip.
   */
  nineSlice?: Asset;
  /** Multiplies the colour of a nine-slice or an image. */
  tint?: number;
};

/**
 * Where an element turns and scales: its centre, the middle of its top edge, its top-left
 * corner, or a point given in fractions of its box.
 *
 * @example
 * ```ts
 * // A sign that hangs from its ropes swings around the middle of its top edge.
 * const origin: Origin = "top";
 * ```
 */
export type Origin = "center" | "top" | "topLeft" | { x: number; y: number };

/**
 * The transform group: how an element is drawn, never where it is laid out. Written into the
 * rest `Transform`, so a hover lift or a pressed sink never moves a sibling.
 *
 * @example
 * ```ts
 * // A button that lifts under the mouse.
 * const lift: TransformStyle = { offsetY: -6, scale: 1.05, origin: "center" };
 * ```
 */
export type TransformStyle = {
  /** Moves the drawn element right, in reference units. */
  offsetX?: number;
  /** Moves the drawn element down, in reference units. */
  offsetY?: number;
  /** Uniform scale around the origin. */
  scale?: number;
  /** The point the element scales and turns around; the centre by default. */
  origin?: Origin;
};

/**
 * Everything but the variants: the five groups of the vocabulary.
 *
 * @example
 * ```ts
 * const base: BaseStyle = { direction: "row", gap: 8, fill: 0x101018 };
 * ```
 */
export type BaseStyle<Asset extends string = string> = FlowStyle &
  BoxStyle &
  PositionStyle &
  VisualStyle<Asset> &
  TransformStyle;

/**
 * The six state variants of a style, applied in the order disabled, active, selected, hover,
 * pressed, covered. While `disabled` is true, `hover` and `pressed` are not applied.
 *
 * @example
 * ```ts
 * // One rule set for every control: lift on hover, sink when pressed, swap the texture when off.
 * const variants: IsVariants = {
 *   hover: { offsetY: -6, scale: 1.05 },
 *   pressed: { offsetY: 4, scale: 0.95 },
 *   disabled: { nineSlice: "ui.button-disabled" }
 * };
 * ```
 */
export type IsVariants<Asset extends string = string> = {
  pressed?: BaseStyle<Asset>;
  disabled?: BaseStyle<Asset>;
  active?: BaseStyle<Asset>;
  selected?: BaseStyle<Asset>;
  /** The mouse or pen is over the element. Touch never hovers. */
  hover?: BaseStyle<Asset>;
  /** The popup the element belongs to is kept under another one. */
  covered?: BaseStyle<Asset>;
};

/**
 * The four viewport variants of a style, applied in the order portrait, landscape, tall, wide.
 *
 * @example
 * ```ts
 * const variants: WhenVariants = { landscape: { direction: "row" } };
 * ```
 */
export type WhenVariants<Asset extends string = string> = {
  portrait?: BaseStyle<Asset>;
  landscape?: BaseStyle<Asset>;
  tall?: BaseStyle<Asset>;
  wide?: BaseStyle<Asset>;
};

/**
 * One style as a game writes it: the base vocabulary plus the two variant tables. `Asset` is the
 * game's asset key union: `uiFor` narrows `nineSlice` to it, the way it narrows `texture`.
 *
 * @example
 * ```ts
 * const topBar: Style = { direction: "row", gap: 12, when: { landscape: { justify: "end" } } };
 * ```
 */
export type Style<Asset extends string = string> = BaseStyle<Asset> & {
  is?: IsVariants<Asset>;
  when?: WhenVariants<Asset>;
};

/**
 * What `resolve` answers with: the base vocabulary with every safe-area token replaced by a
 * number and every variant already merged in. Frozen.
 *
 * @example
 * ```ts
 * const resolved: ResolvedStyle = { direction: "row", gap: 12, padding: 24 };
 * ```
 */
export type ResolvedStyle = Omit<
  BaseStyle,
  "padding" | "margin" | "left" | "top" | "right" | "bottom"
> & {
  padding?: number | { top?: number; right?: number; bottom?: number; left?: number };
  margin?: number | { top?: number; right?: number; bottom?: number; left?: number };
  left?: number;
  top?: number;
  right?: number;
  bottom?: number;
};

/**
 * The viewport flags of a style: which `when` variants apply this frame.
 *
 * @example
 * ```ts
 * const flags: WhenFlags = { portrait: true, landscape: false, tall: true, wide: false };
 * ```
 */
export type WhenFlags = { portrait: boolean; landscape: boolean; tall: boolean; wide: boolean };

/**
 * The state flags of an element: what the markup declared (`disabled`, `active`, `selected`),
 * `pressed` and `hover` from the pointer, and `covered` from the root it belongs to.
 *
 * @example
 * ```ts
 * const flags: IsFlags = {
 *   pressed: false, hover: true, disabled: false, active: true, selected: false, covered: false
 * };
 * ```
 */
export type IsFlags = {
  pressed: boolean;
  hover: boolean;
  disabled: boolean;
  active: boolean;
  selected: boolean;
  covered: boolean;
};

/**
 * A flat table of design tokens a game reads in its styles.
 *
 * @example
 * ```ts
 * const tokens: Tokens = { space: { md: 16 }, color: { panel: 0x101018 } };
 * ```
 */
export type Tokens = {
  readonly space?: Readonly<Record<string, number>>;
  readonly color?: Readonly<Record<string, number>>;
  readonly radius?: Readonly<Record<string, number>>;
  readonly font?: Readonly<Record<string, string>>;
};

/**
 * styles module state: the flags of the frame and the viewport they were read from.
 */
export type StylesState = { flags: WhenFlags; viewport: ViewportSize | undefined };

/**
 * styles module shape, injected into `layout` and `jsx`. Nothing here is public.
 */
export type StylesModule = {
  flagsOf(viewport: ViewportSize): WhenFlags;
  resolveElement(style: Style | undefined, is: IsFlags): ResolvedStyle;
  viewport(): ViewportSize | undefined;
  useViewport(viewport: ViewportSize): boolean;
};
