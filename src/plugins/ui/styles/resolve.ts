/**
 * @file ui/styles — `resolve`: base, then the `when` variants, then the `is` variants, shallow
 * merged, with the four safe-area tokens replaced by the numbers of the viewport. Pure.
 */
import type { ViewportSize } from "../../renderer/viewport/types";
import type {
  BaseStyle,
  Edges,
  IsFlags,
  Length,
  ResolvedStyle,
  Style,
  TextTagStyle,
  WhenFlags
} from "./types";

/**
 * The flags one element is resolved against: the viewport flags of the frame plus its own state.
 *
 * @example
 * ```ts
 * const flags: StyleFlags = {
 *   portrait: true, landscape: false, tall: false, wide: false,
 *   pressed: false, hover: false, focus: false, disabled: false, active: true, selected: false,
 *   covered: false
 * };
 * ```
 */
export type StyleFlags = WhenFlags & IsFlags;

/** The `when` variants in the order they are merged. */
const WHEN_ORDER = ["portrait", "landscape", "tall", "wide"] as const;

/** The `is` variants in the order they are merged. */
const IS_ORDER = [
  "disabled",
  "active",
  "selected",
  "hover",
  "focus",
  "pressed",
  "covered"
] as const;

/** The four tokens a length may be instead of a number. */
const SAFE_AREA = {
  "safeArea.top": "top",
  "safeArea.right": "right",
  "safeArea.bottom": "bottom",
  "safeArea.left": "left"
} as const;

/**
 * Replaces one length that may be a safe-area token with the number of this viewport.
 *
 * @param length - What the style wrote.
 * @param safeArea - The insets of the viewport.
 * @returns The number, or `undefined` when the style wrote nothing.
 * @example
 * ```ts
 * lengthOf("safeArea.top", { top: 44, right: 0, bottom: 34, left: 0 }); // 44
 * ```
 */
function lengthOf(
  length: Length | undefined,
  safeArea: ViewportSize["safeArea"]
): number | undefined {
  if (length === undefined) return undefined;
  if (typeof length === "number") return length;

  return safeArea[SAFE_AREA[length]];
}

/**
 * Replaces the safe-area tokens of a padding or margin, per edge or for all four at once.
 *
 * @param edges - What the style wrote.
 * @param safeArea - The insets of the viewport.
 * @returns The same shape with numbers only.
 * @example
 * ```ts
 * edgesOf({ top: "safeArea.top" }, { top: 44, right: 0, bottom: 0, left: 0 }); // { top: 44 }
 * ```
 */
function edgesOf(
  edges: Edges | undefined,
  safeArea: ViewportSize["safeArea"]
): ResolvedStyle["padding"] {
  if (edges === undefined) return undefined;
  if (typeof edges === "number" || typeof edges === "string") return lengthOf(edges, safeArea);

  const resolved: { top?: number; right?: number; bottom?: number; left?: number } = {};

  for (const edge of ["top", "right", "bottom", "left"] as const) {
    const value = lengthOf(edges[edge], safeArea);

    if (value !== undefined) resolved[edge] = value;
  }

  // Frozen with the style that holds it: a kept resolution is shared by every element of one style object.
  return Object.freeze(resolved);
}

/**
 * Merges one variant over what is there: shallow, as the framework merges configs, a field the variant holds as
 * `undefined` left out. A for-in over the variant, with no rest copy and no entries array.
 *
 * @param into - The style built so far.
 * @param variant - The variant to lay over it.
 * @param keepsText - Whether a `text` field of the variant is merged in. An `is` variant never
 *   moves the text style key: a press must not change the letters, so a plain object that carries
 *   one there is ignored.
 */
function merge(
  into: Record<string, unknown>,
  variant: BaseStyle | undefined,
  keepsText: boolean
): void {
  if (variant === undefined) return;

  const source = variant as Record<string, unknown>;

  for (const field in source) {
    const value = source[field];

    if (value !== undefined && (keepsText || field !== "text")) into[field] = value;
  }
}

/**
 * Merges the base of a style: every field but its two variant tables.
 *
 * @param into - The empty style the merge builds.
 * @param style - The style a game wrote.
 */
function mergeBase(into: Record<string, unknown>, style: Style | TextTagStyle): void {
  const source = style as Record<string, unknown>;

  for (const field in source) {
    if (field === "is" || field === "when") continue;

    const value = source[field];

    if (value !== undefined) into[field] = value;
  }
}

/**
 * Lays the `when` variants of the flags that hold over the base, then the `is` variants. While `disabled` holds the
 * `hover` and `pressed` variants are skipped: a disabled element answers no pointer.
 *
 * @param into - The base, merged.
 * @param style - The style a game wrote.
 * @param flags - The flags of the frame and of the element.
 */
function mergeVariants(
  into: Record<string, unknown>,
  style: Style | TextTagStyle,
  flags: StyleFlags
): void {
  const { is, when } = style;

  if (when !== undefined)
    for (const name of WHEN_ORDER) if (flags[name]) merge(into, when[name], true);
  if (is === undefined) return;

  for (const name of IS_ORDER) {
    const pointer = name === "hover" || name === "pressed";

    if (flags[name] && !(flags.disabled && pointer)) merge(into, is[name], false);
  }
}

/**
 * The padding or margin a resolution hands out. Frozen edges with numbers only, as `defineStyle` leaves them, go as
 * they are; edges a game wrote inline, or that hold a safe-area token, are copied and frozen, so no element can write
 * into another element's edges.
 *
 * @param edges - What the merged style holds.
 * @param safeArea - The insets of the viewport.
 * @returns The edges with numbers only.
 */
function resolvedEdges(edges: Edges, safeArea: ViewportSize["safeArea"]): ResolvedStyle["padding"] {
  if (typeof edges !== "object") return lengthOf(edges, safeArea);

  const sides = edges as Record<string, unknown>;
  const numbers =
    typeof sides.top !== "string" &&
    typeof sides.right !== "string" &&
    typeof sides.bottom !== "string" &&
    typeof sides.left !== "string";

  return numbers && Object.isFrozen(edges)
    ? (edges as ResolvedStyle["padding"])
    : edgesOf(edges, safeArea);
}

/**
 * Replaces every safe-area token of a merged style with the number of this viewport.
 *
 * @param merged - The style after the variants were laid over the base; it holds no `undefined`.
 * @param viewport - What `renderer.viewport.size()` answered.
 * @returns The same object, with numbers where the tokens were.
 */
function withSafeArea(merged: Record<string, unknown>, viewport: ViewportSize): ResolvedStyle {
  const safeArea = viewport.safeArea;

  if (merged.padding !== undefined)
    merged.padding = resolvedEdges(merged.padding as Edges, safeArea);
  if (merged.margin !== undefined) merged.margin = resolvedEdges(merged.margin as Edges, safeArea);
  if (typeof merged.left === "string") merged.left = lengthOf(merged.left as Length, safeArea);
  if (typeof merged.top === "string") merged.top = lengthOf(merged.top as Length, safeArea);
  if (typeof merged.right === "string") merged.right = lengthOf(merged.right as Length, safeArea);
  if (typeof merged.bottom === "string")
    merged.bottom = lengthOf(merged.bottom as Length, safeArea);

  return merged as ResolvedStyle;
}

/**
 * Resolves one style against the flags of the frame and the viewport.
 *
 * @param style - The style a game wrote, or nothing.
 * @param flags - The four viewport flags and the seven state flags. While `disabled` is true the
 *   `hover` and `pressed` variants are skipped.
 * @param viewport - What `renderer.viewport.size()` answered, for the safe-area tokens.
 * @returns The frozen style the layout and the visual are written from.
 * @example
 * ```ts
 * resolve(
 *   { gap: 8, is: { pressed: { gap: 4 } } },
 *   { portrait: true, landscape: false, tall: false, wide: false,
 *     pressed: true, hover: false, focus: false, disabled: false, active: false, selected: false,
 *     covered: false },
 *   { width: 1080, height: 1920, scale: 1, orientation: "portrait",
 *     safeArea: { top: 0, right: 0, bottom: 0, left: 0 } }
 * ).gap; // 4
 * ```
 */
export function resolve(
  style: Style | TextTagStyle | undefined,
  flags: StyleFlags,
  viewport: ViewportSize
): ResolvedStyle {
  const merged: Record<string, unknown> = {};

  if (style !== undefined) {
    mergeBase(merged, style);
    mergeVariants(merged, style, flags);
  }

  return Object.freeze(withSafeArea(merged, viewport));
}
