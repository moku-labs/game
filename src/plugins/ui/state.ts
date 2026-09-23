/**
 * @file ui plugin — state factory: one branch per module, composed from the module factories.
 */
import { createJsxState } from "./jsx/state";
import { createLayoutState } from "./layout/state";
import { createStylesState } from "./styles/state";
import type { Config, State } from "./types";

/**
 * Creates the initial ui state. Nothing is mounted and Yoga is not loaded: `onStart` fills both.
 *
 * @param _ctx - Minimal context. The ui state depends on nothing in it.
 * @param _ctx.config - Resolved plugin config.
 * @returns The plugin state.
 * @example
 * ```ts
 * const focusRing = {
 *   stroke: 0x3a2212, strokeWidth: 4, dash: 10, offset: 9, halo: 0xfff3d6, haloWidth: 12
 * };
 *
 * createUiState({ config: { tapTargetPt: 44, breakpoints: { tall: 2, wide: 1.5 }, focusRing } })
 *   .layout.nodes; // 0
 * ```
 */
export function createUiState(_ctx: { readonly config: Readonly<Config> }): State {
  return { jsx: createJsxState(), styles: createStylesState(), layout: createLayoutState() };
}
