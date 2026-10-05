/**
 * @file text plugin — API factory. Four members: how big a piece of text is, whether a font has
 * a glyph, which styles the game registered, and the dev hot swap of a styles file. The domain context is built on the first call, because the kernel builds the
 * plugin APIs before every dependency is resolvable.
 */
import { replaceStyles, withDeps } from "./lifecycle";
import { hasGlyphOf, layoutFor, sizeOf, sourceOf } from "./resolve";
import type { KernelSlice, TextApi, TextCtx } from "./types";

/**
 * Creates the text API: `app.text.measure(...)`, `app.text.hasGlyph(...)`, `app.text.styles()`
 * and `app.text.replaceStyles(...)`.
 *
 * @param ctx - Kernel context of the text plugin.
 * @returns The plugin API.
 */
export function createTextApi(ctx: KernelSlice): TextApi {
  let domain: TextCtx | undefined;

  const text = (): TextCtx => {
    domain ??= withDeps(ctx);

    return domain;
  };

  return {
    measure: (content, style) => {
      const tctx = text();

      return sizeOf(layoutFor(tctx, sourceOf(tctx, content), style));
    },
    hasGlyph: (char, style) => hasGlyphOf(text(), char, style),
    styles: () => Object.freeze([...ctx.state.styles.keys()]),
    replaceStyles: styles => {
      replaceStyles(text(), styles);
    }
  };
}
