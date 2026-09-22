/**
 * @file ui plugin — API factory. The one place the three modules are built, in the injection
 * order `styles → layout → jsx`, and the one place the public half is spread flat onto `app.ui`.
 */

import { createJsxApi } from "./jsx/api";
import type { JsxModule } from "./jsx/types";
import { createLayoutApi } from "./layout/api";
import type { LayoutModule } from "./layout/types";
import { withDeps } from "./lifecycle";
import { createStylesApi } from "./styles/api";
import type { StylesModule } from "./styles/types";
import type { KernelSlice, UiApi, UiCtx } from "./types";

/**
 * Builds the three modules in the accepted injection order. Each keeps its data in its branch of
 * `ctx.state`, so these objects are views on the plugin state, not owners of it.
 *
 * @param ctx - Domain context of the ui plugin.
 * @returns The three modules.
 */
export function createModules(ctx: UiCtx): {
  styles: StylesModule;
  layout: LayoutModule;
  jsx: JsxModule;
} {
  const styles = createStylesApi(ctx);
  const layout = createLayoutApi(ctx);
  const jsx = createJsxApi(ctx, { styles, layout });

  return { styles, layout, jsx };
}

/**
 * Creates the ui API: the three members a game calls, flat.
 *
 * @param ctx - Kernel context of the ui plugin.
 * @returns The plugin API.
 */
export function createUiApi(ctx: KernelSlice): UiApi {
  const { jsx } = createModules(withDeps(ctx));

  return { tree: jsx.tree, find: jsx.find, lint: jsx.lint };
}
