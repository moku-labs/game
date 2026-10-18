/**
 * @file ui/styles — the module factory. It is injected into `layout` and `jsx`; nothing it
 * returns reaches the public API.
 */
import type { ViewportSize } from "../../renderer/viewport/types";
import type { UiCtx } from "../types";
import { flagsOf, sameViewport } from "./flags";
import { resolve, type StyleFlags } from "./resolve";
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
  // Per restyle: the flags an element is resolved against, one object written in place; `resolve`
  // reads it and keeps nothing. A merged object per call would also hand V8 a hidden class that
  // dies at every full GC, which throws the optimized `resolve` away ("embedded weak objects").
  const flags: StyleFlags = {
    portrait: true,
    landscape: false,
    tall: false,
    wide: false,
    pressed: false,
    hover: false,
    focus: false,
    disabled: false,
    active: false,
    selected: false,
    covered: false
  };

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

    resolveElement: (style: Style | undefined, is: IsFlags): ResolvedStyle => {
      const when = state.flags;

      flags.portrait = when.portrait;
      flags.landscape = when.landscape;
      flags.tall = when.tall;
      flags.wide = when.wide;
      flags.pressed = is.pressed;
      flags.hover = is.hover;
      flags.focus = is.focus;
      flags.disabled = is.disabled;
      flags.active = is.active;
      flags.selected = is.selected;
      flags.covered = is.covered;

      return resolve(style, flags, state.viewport ?? FALLBACK_VIEWPORT);
    }
  };
}
