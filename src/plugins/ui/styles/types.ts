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
 * const box: BoxStyle = { padding: 16, width: "100%", height: 96 };
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
  overflow?: "visible" | "hidden" | "scroll";
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
 * const visual: VisualStyle = { fill: 0x101018, radius: 16, alpha: 1 };
 * ```
 */
export type VisualStyle = {
  fill?: number;
  stroke?: number;
  strokeWidth?: number;
  radius?: number;
  alpha?: number;
};

/**
 * Everything but the variants: the four groups of the vocabulary.
 *
 * @example
 * ```ts
 * const base: BaseStyle = { direction: "row", gap: 8, fill: 0x101018 };
 * ```
 */
export type BaseStyle = FlowStyle & BoxStyle & PositionStyle & VisualStyle;

/**
 * The four state variants of a style, applied in the order disabled, active, selected, pressed.
 *
 * @example
 * ```ts
 * const variants: IsVariants = { pressed: { alpha: 0.7 } };
 * ```
 */
export type IsVariants = {
  pressed?: BaseStyle;
  disabled?: BaseStyle;
  active?: BaseStyle;
  selected?: BaseStyle;
};

/**
 * The four viewport variants of a style, applied in the order portrait, landscape, tall, wide.
 *
 * @example
 * ```ts
 * const variants: WhenVariants = { landscape: { direction: "row" } };
 * ```
 */
export type WhenVariants = {
  portrait?: BaseStyle;
  landscape?: BaseStyle;
  tall?: BaseStyle;
  wide?: BaseStyle;
};

/**
 * One style as a game writes it: the base vocabulary plus the two variant tables.
 *
 * @example
 * ```ts
 * const topBar: Style = { direction: "row", gap: 12, when: { landscape: { justify: "end" } } };
 * ```
 */
export type Style = BaseStyle & { is?: IsVariants; when?: WhenVariants };

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
 * The state flags of an element: what the markup declared plus `pressed` from the pointer.
 *
 * @example
 * ```ts
 * const flags: IsFlags = { pressed: false, disabled: false, active: true, selected: false };
 * ```
 */
export type IsFlags = { pressed: boolean; disabled: boolean; active: boolean; selected: boolean };

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
