/**
 * @file ui/styles — state factory: the flags of the frame and the viewport they were read from.
 */
import type { StylesState } from "./types";

/**
 * Creates the styles branch of the ui state. A game is portrait until the first frame read the
 * real viewport, which is the orientation of the framework config default.
 *
 * @returns The module state.
 * @example
 * ```ts
 * createStylesState().viewport; // undefined
 * ```
 */
export function createStylesState(): StylesState {
  return {
    flags: { portrait: true, landscape: false, tall: false, wide: false },
    viewport: undefined
  };
}
