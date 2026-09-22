/**
 * @file renderer/sync — the bitmap fonts. `assets` loads the `.fnt` file and its page texture,
 * `text` hands both over, and the renderer is the one place that turns them into a Pixi font.
 * Nothing here runs headless: the renderer has no Pixi module to install into.
 */
import type { BitmapFontData, PixiModule, PixiTexture } from "../types";
import type { SyncCtx, SyncState } from "./types";

/** What a font is cached under, so a `BitmapText` with that `fontFamily` finds it. */
const CACHE_SUFFIX = "-bitmap";

/**
 * Tells whether a parsed JSON file carries the two tables a BMFont needs.
 *
 * @param value - What `JSON.parse` returned.
 * @returns True when it can be used as font data.
 */
function isFontData(value: unknown): value is BitmapFontData {
  return typeof value === "object" && value !== null && "chars" in value && "pages" in value;
}

/**
 * Reads a `.fnt` file in any of the three shapes a font exporter writes.
 *
 * @param pixi - The Pixi module, which brings the two BMFont readers.
 * @param key - The asset key, for the error.
 * @param fnt - The file contents.
 * @returns The font data.
 * @throws {Error} When the file is none of the three formats.
 */
function parseFont(pixi: PixiModule, key: string, fnt: string): BitmapFontData {
  if (fnt.trimStart().startsWith("{")) {
    const parsed: unknown = JSON.parse(fnt);

    if (isFontData(parsed)) return parsed;
  } else {
    if (pixi.bitmapFontTextParser.test(fnt)) return pixi.bitmapFontTextParser.parse(fnt);
    if (pixi.bitmapFontXMLStringParser.test(fnt)) return pixi.bitmapFontXMLStringParser.parse(fnt);
  }

  throw new Error(
    `[game] Font "${key}" is not a BMFont file.\n` +
      "  Export it as .fnt (BMFont text or XML) or as BMFont JSON."
  );
}

/**
 * Installs a font for an asset key. Installing the same key again replaces the font, which is
 * what a bundle that was unloaded and loaded again needs.
 *
 * @param sctx - Domain context of the sync module.
 * @param key - The asset key of the font.
 * @param fnt - The `.fnt` file contents.
 * @param texture - The page texture `assets` uploaded.
 * @throws {Error} When the renderer does not draw.
 */
export function installFont(sctx: SyncCtx, key: string, fnt: string, texture: PixiTexture): void {
  const pixi = sctx.deps.host.pixi();

  if (pixi === undefined) {
    throw new Error(
      "[game] Fonts need a renderer.\n  Call fonts.install after renderer.host.ready()."
    );
  }

  const state = sctx.ctx.state.sync;
  const font = new pixi.BitmapFont({ data: parseFont(pixi, key, fnt), textures: [texture] });
  const cacheKey = `${key}${CACHE_SUFFIX}`;

  if (pixi.Cache.has(cacheKey)) pixi.Cache.remove(cacheKey);

  pixi.Cache.set(cacheKey, font);
  state.fonts.set(key, font);
  state.fontCache = pixi.Cache;
}

/**
 * Tells whether a font key is installed in this application.
 *
 * @param state - The sync branch of the plugin state.
 * @param key - The asset key of the font.
 * @returns True when the font is there.
 */
export function isFontInstalled(state: SyncState, key: string): boolean {
  return state.fonts.has(key);
}

/**
 * Takes every installed font out of the global Pixi cache and frees it, so a stopped application
 * leaves no font whose page textures are already gone.
 *
 * @param state - The sync branch of the plugin state.
 */
export function clearFonts(state: SyncState): void {
  for (const [key, font] of state.fonts) {
    state.fontCache?.remove(`${key}${CACHE_SUFFIX}`);
    font.destroy();
  }

  state.fonts.clear();
  state.fontCache = undefined;
}
