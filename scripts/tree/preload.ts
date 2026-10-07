/**
 * @file Bun preload for a game run against this engine working tree:
 * `moku-game dev --preload <tree>/scripts/tree/preload.ts`, or `bun --preload` of a game's own
 * script. Every entry of the installed engine, `node_modules/@moku-labs/game/dist/<entry>.mjs`,
 * loads `<tree>/src/<entry>.ts` instead. The default export of `hot` and `lint` stays.
 *
 * The entries and the tree come from `bundle.ts`, the bundler half of the same recipe: no path and
 * no variable is written down. The tree's own imports of Pixi, core and common resolve from the
 * tree's `node_modules` here: Bun calls no runtime `onResolve` for them. That is safe, because a
 * game imports none of the three itself; the dev page bundle dedupes them through `bundle.ts`.
 * Repo only: not in the npm `files`.
 */
import { readFileSync } from "node:fs";
import { entrySource, treeEntries } from "./bundle";

/** The arguments Bun hands an `onLoad` callback, the part this preload reads. */
export type PreloadModule = {
  /** The absolute path of the module, such as `<game>/node_modules/@moku-labs/game/dist/hot.mjs`. */
  path: string;
};

/** An `onLoad` callback: the text of the module, which re-exports the tree's source. */
export type PreloadLoad = (args: PreloadModule) => { contents: string; loader: "js" };

/** The part of Bun's plugin builder this preload uses. Bun's `PluginBuilder` fits it. */
export type PreloadBuild = {
  /**
   * Registers a load callback for the modules whose path matches `filter`.
   *
   * @param options - The filter on the absolute path of a module.
   * @param options.filter - Only a path that matches it loads through the callback.
   * @param load - Gives the text of the module.
   */
  onLoad(options: { filter: RegExp }, load: PreloadLoad): void;
};

/** A Bun plugin object, as `Bun.plugin` registers it for the runtime. */
export type PreloadPlugin = {
  /** The plugin name Bun reports in its errors. */
  name: string;
  /**
   * Registers the load callback of the installed engine's entries.
   *
   * @param build - Bun's plugin builder.
   */
  setup(build: PreloadBuild): void;
};

/** A path separator of either system: Bun hands `\` separated paths on Windows. */
const SEPARATOR = String.raw`[\\/]`;

/** A file that has a default export: `export *` leaves the default out. */
const DEFAULT_EXPORT = /^export default /mu;

/**
 * Escapes the characters of a name that a regular expression reads as syntax.
 *
 * @param text - The name.
 * @returns The name as a literal pattern.
 * @example
 * ```ts
 * escapeRegExp("jsx-runtime.v2"); // "jsx-runtime\\.v2"
 * ```
 */
function escapeRegExp(text: string): string {
  return text.replaceAll(/[$()*+.?[\\\]^{|}]/gu, String.raw`\$&`);
}

/**
 * The filter on the dist files of the installed engine's entries, either path separator. The one
 * group captures the entry, with the separators of the path.
 *
 * @param entries - The entry names, `/` separated.
 * @returns The filter.
 */
export function distPattern(entries: readonly string[]): RegExp {
  const names = entries.map(entry =>
    entry
      .split("/")
      .map(part => escapeRegExp(part))
      .join(SEPARATOR)
  );
  const folder = ["node_modules", "@moku-labs", "game", "dist"].join(SEPARATOR);

  return new RegExp(String.raw`${SEPARATOR}${folder}${SEPARATOR}(${names.join("|")})\.mjs$`, "u");
}

/**
 * The text that replaces one entry of the installed engine: a re-export of the tree's source, with
 * the default export when the source has one.
 *
 * @param entry - The entry name, `/` separated.
 * @returns The module text.
 */
function treeModule(entry: string): string {
  const source = entrySource(entry);
  const file = JSON.stringify(source);
  const named = `export * from ${file};`;

  return DEFAULT_EXPORT.test(readFileSync(source, "utf8"))
    ? `${named} export { default } from ${file};`
    : named;
}

/** Loads the tree's source for every entry of the installed engine. */
export const treePreload: PreloadPlugin = {
  name: "moku-game-tree-preload",
  /**
   * Registers the load callback on the dist files of the tree's entries.
   *
   * @param build - Bun's plugin builder.
   */
  setup(build) {
    const filter = distPattern(treeEntries());

    build.onLoad({ filter }, args => {
      const entry = (filter.exec(args.path)?.[1] ?? "index").replaceAll("\\", "/");

      return { contents: treeModule(entry), loader: "js" };
    });
  }
};

Bun.plugin(treePreload);
