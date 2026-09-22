/**
 * @file text plugin — API factory. Two members: how big a piece of text is, and which styles the
 * game registered. The domain context is built on the first call, because the kernel builds the
 * plugin APIs before every dependency is resolvable.
 */
import { withDeps } from "./lifecycle";
import { layoutFor, sizeOf, sourceOf } from "./resolve";
import type { KernelSlice, TextApi, TextCtx } from "./types";

/**
 * Creates the text API: `app.text.measure(...)` and `app.text.styles()`.
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
    styles: () => Object.freeze([...ctx.state.styles.keys()])
  };
}
