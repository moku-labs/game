/**
 * @file ui/styles — the `when` flags of the frame, read from the viewport and the breakpoints.
 * Pure: the same viewport always gives the same four booleans.
 */
import type { ViewportSize } from "../../renderer/viewport/types";
import type { IsFlags, WhenFlags } from "./types";

/**
 * Reads the four viewport flags of a frame.
 *
 * @param viewport - What `renderer.viewport.size()` answered.
 * @param breakpoints - The two ratios of the plugin config.
 * @param breakpoints.tall - Height over width from which `tall` is true.
 * @param breakpoints.wide - Width over height from which `wide` is true.
 * @returns The four flags.
 * @example
 * ```ts
 * flagsOf(
 *   { width: 1080, height: 2400, scale: 1, orientation: "portrait",
 *     safeArea: { top: 0, right: 0, bottom: 0, left: 0 } },
 *   { tall: 2, wide: 1.5 }
 * ); // { portrait: true, landscape: false, tall: true, wide: false }
 * ```
 */
export function flagsOf(
  viewport: ViewportSize,
  breakpoints: { tall: number; wide: number }
): WhenFlags {
  const { width, height } = viewport;

  return {
    portrait: viewport.orientation === "portrait",
    landscape: viewport.orientation === "landscape",
    tall: width > 0 && height / width >= breakpoints.tall,
    wide: height > 0 && width / height >= breakpoints.wide
  };
}

/**
 * The state flags of an element that declared none.
 *
 * @returns Six false flags.
 * @example
 * ```ts
 * noFlags().hover; // false
 * ```
 */
export function noFlags(): IsFlags {
  return {
    pressed: false,
    hover: false,
    disabled: false,
    active: false,
    selected: false,
    covered: false
  };
}

/**
 * Tells whether two viewports would give the same rects: a different size or notch re-resolves
 * every element, a different scale alone does not.
 *
 * @param first - The viewport of the last frame, or nothing.
 * @param second - The viewport of this frame.
 * @returns True when nothing that reaches a style changed.
 */
export function sameViewport(first: ViewportSize | undefined, second: ViewportSize): boolean {
  if (first === undefined) return false;

  return (
    first.width === second.width &&
    first.height === second.height &&
    first.orientation === second.orientation &&
    first.safeArea.top === second.safeArea.top &&
    first.safeArea.right === second.safeArea.right &&
    first.safeArea.bottom === second.safeArea.bottom &&
    first.safeArea.left === second.safeArea.left
  );
}
