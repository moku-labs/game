/**
 * @file ui/styles — the module factory. It is injected into `layout` and `jsx`; nothing it
 * returns reaches the public API.
 */
import type { ViewportSize } from "../../renderer/viewport/types";
import type { UiCtx } from "../types";
import { flagsOf, sameViewport } from "./flags";
import { resolve, type StyleFlags } from "./resolve";
import type { IsFlags, ResolvedStyle, Style, StylesModule, TextTagStyle } from "./types";

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
  // The resolved style of each style object a game wrote, kept until the object is gone; and the viewport epoch,
  // which a new size or safe area moves on. A cell: a number in a closure would be a new heap number at each write.
  const resolved = new WeakMap<object, Resolution>();
  const epoch = new Int32Array(1);

  return {
    flagsOf: (viewport: Readonly<ViewportSize>) => flagsOf(viewport, ctx.config.breakpoints),

    viewport: () => state.viewport,

    useViewport: (viewport: Readonly<ViewportSize>): boolean => {
      // The same frame: `renderer.viewport.size()` hands out one frozen object until the frame changes.
      if (viewport === state.viewport) return false;

      const changed = !sameViewport(state.viewport, viewport);

      state.viewport = viewport;
      state.flags = flagsOf(viewport, ctx.config.breakpoints);
      // A new size or safe area may resolve every style otherwise: the kept resolutions are stale.
      if (changed) epoch[0] = (epoch[0] ?? 0) + 1;

      return changed;
    },

    resolveElement: (style: Style | TextTagStyle | undefined, is: IsFlags): ResolvedStyle => {
      const known = style === undefined ? undefined : resolved.get(style);
      const mask = maskOf(is);
      const at = epoch[0] ?? 0;

      // The same style object, the same state flags and the same viewport resolve to what they resolved to (F244 В).
      if (known !== undefined && known.mask === mask && known.epoch === at) return known.style;

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

      const made = resolve(style, flags, state.viewport ?? FALLBACK_VIEWPORT);

      if (style === undefined) return made;

      // One record per style object, written in place: a style resolved again under other flags takes the slot.
      if (known === undefined) resolved.set(style, { mask, epoch: at, style: made });
      else {
        known.mask = mask;
        known.epoch = at;
        known.style = made;
      }

      return made;
    }
  };
}

/** The last resolution of one style object: the state flags and the viewport epoch it was made under. */
type Resolution = { mask: number; epoch: number; style: ResolvedStyle };

/**
 * The seven state flags of an element as one number, a bit each.
 *
 * @param is - The state flags.
 * @returns The bits.
 * @example
 * ```ts
 * maskOf({ pressed: true, hover: false, focus: false, disabled: false, active: false, selected: false, covered: false }); // 1
 * ```
 */
function maskOf(is: IsFlags): number {
  return (
    (is.pressed ? 1 : 0) |
    (is.hover ? 2 : 0) |
    (is.focus ? 4 : 0) |
    (is.disabled ? 8 : 0) |
    (is.active ? 16 : 0) |
    (is.selected ? 32 : 0) |
    (is.covered ? 64 : 0)
  );
}
