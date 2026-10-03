/**
 * @file text plugin — API factory. Three members: how big a piece of text is, whether a font has
 * a glyph, and which styles the game registered. The domain context is built on the first call, because the kernel builds the
 * plugin APIs before every dependency is resolvable.
 */
import { withDeps } from "./lifecycle";
import { hasGlyphOf, layoutFor, sizeOf, sourceOf } from "./resolve";
import type { KernelSlice, TextApi, TextCtx } from "./types";

/**
 * Creates the text API: `app.text.measure(...)`, `app.text.hasGlyph(...)` and `app.text.styles()`.
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
    styles: () => Object.freeze([...ctx.state.styles.keys()])
  };
}
