/**
 * @file ui/styles — the module factory. It is injected into `layout` and `jsx`; nothing it
 * returns reaches the public API.
 */
import type { ViewportSize } from "../../renderer/viewport/types";
import type { UiCtx } from "../types";
import { flagsOf, sameViewport } from "./flags";
import { resolve } from "./resolve";
import type { IsFlags, ResolvedStyle, Style, StylesModule } from "./types";

/** What an element is resolved against before the first frame read the real viewport. */
const FALLBACK_VIEWPORT: Readonly<ViewportSize> = {
  width: 0,
  height: 0,
  scale: 1,
  orientation: "portrait",
  safeArea: { top: 0, right: 0, bottom: 0, left: 0 }
};

/**
 * Builds the styles module: the flags of the frame and the resolve of one element.
 *
 * @param ctx - Domain context of the ui plugin.
 * @returns The module, for `layout` and `jsx`.
 */
export function createStylesApi(ctx: UiCtx): StylesModule {
  const state = ctx.state.styles;

  return {
    flagsOf: (viewport: Readonly<ViewportSize>) => flagsOf(viewport, ctx.config.breakpoints),

    viewport: () => state.viewport,

    useViewport: (viewport: Readonly<ViewportSize>): boolean => {
      // The same frame: `renderer.viewport.size()` hands out one frozen object until the frame changes.
      if (viewport === state.viewport) return false;

      const changed = !sameViewport(state.viewport, viewport);

      state.viewport = viewport;
      state.flags = flagsOf(viewport, ctx.config.breakpoints);

      return changed;
    },

    resolveElement: (style: Style | undefined, is: IsFlags): ResolvedStyle =>
      resolve(style, { ...state.flags, ...is }, state.viewport ?? FALLBACK_VIEWPORT)
  };
}
