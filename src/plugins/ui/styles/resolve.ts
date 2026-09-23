/**
 * @file ui/styles — `resolve`: base, then the `when` variants, then the `is` variants, shallow
 * merged, with the four safe-area tokens replaced by the numbers of the viewport. Pure.
 */
import type { ViewportSize } from "../../renderer/viewport/types";
import type { BaseStyle, Edges, IsFlags, Length, ResolvedStyle, Style, WhenFlags } from "./types";

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

  return resolved;
}

/**
 * Merges one variant over what is there. Shallow, as the framework merges configs.
 *
 * @param into - The style built so far.
 * @param variant - The variant to lay over it.
 */
function merge(into: Record<string, unknown>, variant: BaseStyle | undefined): void {
  if (variant === undefined) return;

  for (const [field, value] of Object.entries(variant)) {
    if (value !== undefined) into[field] = value;
  }
}

/**
 * Replaces every safe-area token of a merged style with the number of this viewport.
 *
 * @param merged - The style after the variants were laid over the base.
 * @param viewport - What `renderer.viewport.size()` answered.
 * @returns The same object, with numbers where the tokens were.
 */
function withSafeArea(merged: Record<string, unknown>, viewport: ViewportSize): ResolvedStyle {
  const resolved = merged as ResolvedStyle & Record<string, unknown>;

  for (const edge of ["padding", "margin"] as const) {
    const value = edgesOf(merged[edge] as Edges | undefined, viewport.safeArea);

    if (value === undefined) delete resolved[edge];
    else resolved[edge] = value;
  }

  for (const edge of ["left", "top", "right", "bottom"] as const) {
    const value = lengthOf(merged[edge] as Length | undefined, viewport.safeArea);

    if (value === undefined) delete resolved[edge];
    else resolved[edge] = value;
  }

  return resolved;
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
  style: Style | undefined,
  flags: StyleFlags,
  viewport: ViewportSize
): ResolvedStyle {
  const merged: Record<string, unknown> = {};

  if (style !== undefined) {
    const { is, when, ...base } = style;

    merge(merged, base);

    for (const name of WHEN_ORDER) if (flags[name]) merge(merged, when?.[name]);
    for (const name of IS_ORDER) {
      // A disabled element answers no pointer, so it never shows hover or pressed.
      const pointer = name === "hover" || name === "pressed";

      if (!flags[name] || (flags.disabled && pointer)) continue;

      merge(merged, is?.[name]);
    }
  }

  return Object.freeze(withSafeArea(merged, viewport));
}
