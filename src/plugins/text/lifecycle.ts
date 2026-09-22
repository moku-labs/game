/**
 * @file text plugin — lifecycle: the dependency resolution, the style table read out of the
 * feature descriptions, the four registrations `onStart` opens, and the teardown that closes
 * exactly those.
 */
import { assetsPlugin } from "../assets";
import { flowPlugin } from "../flow";
import { i18nPlugin } from "../i18n";
import { rendererPlugin } from "../renderer";
import { timePlugin } from "../time";
import { worldPlugin } from "../world";
import { builtInStyles, readStyle, Text } from "./components";
import { createTextAdapter, installFonts } from "./display";
import { createTextSystem, forgetText } from "./resolve";
import type { Deps, KernelSlice, State, TextCtx } from "./types";

/** The owner of the two built-in styles, which no feature can collide with. */
const BUILT_IN = "text";

/**
 * Resolves the six dependency APIs with `ctx.require`.
 *
 * @param ctx - Kernel context of the text plugin.
 * @returns The six dependency APIs.
 */
function resolveDeps(ctx: KernelSlice): Deps {
  return {
    time: ctx.require(timePlugin),
    flow: ctx.require(flowPlugin),
    world: ctx.require(worldPlugin),
    renderer: ctx.require(rendererPlugin),
    assets: ctx.require(assetsPlugin),
    i18n: ctx.require(i18nPlugin)
  };
}

/**
 * Builds the domain context the API, the hooks and the frame step share.
 *
 * @param ctx - Kernel context of the text plugin.
 * @returns The domain context of the text plugin.
 */
export function withDeps(ctx: KernelSlice): TextCtx {
  return { ...ctx, deps: resolveDeps(ctx) };
}

/**
 * Tells whether a feature entry is a style map `text` can read.
 *
 * @param entry - What the feature put under its `textStyles` key.
 * @returns True when it carries a map of styles.
 */
function isStyleMap(entry: unknown): entry is { map: Record<string, object> } {
  return (
    typeof entry === "object" &&
    entry !== null &&
    "kind" in entry &&
    entry.kind === "textStyles" &&
    "map" in entry &&
    typeof entry.map === "object" &&
    entry.map !== null
  );
}

/**
 * Fills the style table: the two built-ins first, then the styles of every feature in feature
 * order. A feature may override a built-in; two features may not share a name.
 *
 * @param ctx - Domain context of the text plugin.
 * @throws {Error} When two features define the same style name.
 */
function buildStyles(ctx: TextCtx): void {
  for (const [name, style] of Object.entries(builtInStyles(ctx.config.fonts))) {
    ctx.state.styles.set(name, style);
    ctx.state.styleOwner.set(name, BUILT_IN);
  }

  for (const feature of ctx.deps.flow.features.all()) {
    const entry = feature.description.textStyles;

    if (!isStyleMap(entry)) continue;

    for (const [name, value] of Object.entries(entry.map)) {
      const owner = ctx.state.styleOwner.get(name);

      if (owner !== undefined && owner !== BUILT_IN) {
        throw new Error(
          `[game] Text style "${name}" is defined by features "${owner}" and "${feature.name}".\n` +
            "  Keep it in one feature or rename one of them."
        );
      }

      const style = readStyle(name, value);

      if (style === undefined) continue;

      ctx.state.styles.set(name, style);
      ctx.state.styleOwner.set(name, feature.name);
    }
  }
}

/**
 * Collects every font a style can draw with: the two of the config, then the regular, bold and
 * italic font of every registered style.
 *
 * @param ctx - Domain context of the text plugin.
 */
function collectFonts(ctx: TextCtx): void {
  ctx.state.fontKeys.add(ctx.config.fonts.body);
  ctx.state.fontKeys.add(ctx.config.fonts.digits);

  for (const style of ctx.state.styles.values()) {
    ctx.state.fontKeys.add(style.font);

    if (style.bold !== undefined) ctx.state.fontKeys.add(style.bold);
    if (style.italic !== undefined) ctx.state.fontKeys.add(style.italic);
  }
}

/**
 * Opens what the plugin owns: the style table, the font keys, the layout system, the two world
 * hooks of `Text` and the display adapter. The fonts of a bundle that is already loaded are read
 * at once, because the boot bundle lands before this runs.
 *
 * @param ctx - Kernel context of the text plugin.
 * @throws {Error} When two features define the same style name.
 */
export function startText(ctx: KernelSlice): void {
  const tctx = withDeps(ctx);
  const ecs = tctx.deps.world.ecs;

  buildStyles(tctx);
  collectFonts(tctx);

  tctx.state.removers.push(
    ecs.system(createTextSystem(tctx)),
    ecs.onAdded(Text, entity => {
      tctx.state.dirty.add(entity);
    }),
    ecs.onRemoved(Text, entity => {
      forgetText(tctx.state, entity);
    }),
    tctx.deps.renderer.sync.displays.provide(Text, createTextAdapter(tctx))
  );

  installFonts(tctx);
}

/**
 * Closes what the plugin opened: the system, the two world hooks and the adapter. The Pixi
 * objects the adapter built are the renderer's, and it frees them in its own teardown.
 *
 * @param state - The plugin state, the only thing a teardown context carries.
 */
export function stopText(state: State): void {
  for (const off of state.removers) off();

  state.removers.length = 0;
  state.styles.clear();
  state.styleOwner.clear();
  state.fontKeys.clear();
  state.tables.clear();
  state.installed.clear();
  state.seen.clear();
  state.bindTypes.clear();
  state.measured.clear();
  state.cache.clear();
  state.dirty.clear();
  state.warned.clear();
}
