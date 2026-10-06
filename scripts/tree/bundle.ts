/**
 * @file Bundler plugin of the dev page for a game run against this engine working tree:
 * `moku-game dev --serve-plugin <tree>/scripts/tree/bundle.ts`. The game's imports of
 * `@moku-labs/game` and its entries bundle from `<tree>/src/<entry>.ts`, not from the installed
 * `dist`. The tree's own imports of Pixi, core and common resolve from the game root, the working
 * directory, so the page holds one copy of each.
 *
 * The tree is the folder two levels above this file, found from `import.meta.url`: no path and no
 * variable is written down anywhere. The entries come from the `exports` of the tree's
 * package.json, so a new entry needs no change here. The preload of the same recipe
 * (`preload.ts`) reads the same entries from this file. Repo only: not in the npm `files`.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The arguments Bun hands an `onResolve` callback, the part this plugin reads. */
export type TreeImport = {
  /** The import, such as `@moku-labs/game/testing`. */
  path: string;
  /** The absolute path of the file that imports it. */
  importer: string;
};

/**
 * An `onResolve` callback: the absolute path of the file to bundle, or `undefined` to leave the
 * import to Bun.
 */
export type TreeResolve = (args: TreeImport) => { path: string } | undefined;

/** The part of Bun's plugin builder this plugin uses. Bun's `PluginBuilder` fits it. */
export type TreeBuild = {
  /**
   * Registers a resolve callback for the imports that match `filter`.
   *
   * @param options - The filter on the import.
   * @param options.filter - Only an import that matches it goes through the callback.
   * @param resolve - Gives the file of the import.
   */
  onResolve(options: { filter: RegExp }, resolve: TreeResolve): void;
};

/** A Bun plugin object, as `[serve.static] plugins` in `bunfig.toml` loads it. */
export type TreePlugin = {
  /** The plugin name Bun reports in its errors. */
  name: string;
  /**
   * Registers the resolve callbacks of the engine entries and of the shared packages.
   *
   * @param build - Bun's plugin builder.
   */
  setup(build: TreeBuild): void;
};

/** The engine working tree: the folder two levels above `scripts/tree/`. */
export const treeRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));

/** An import of the engine or of one of its entries, nested entries such as `app/page` too. */
const ENGINE_IMPORT = /^@moku-labs\/game(?:\/[\w/-]+)?$/;

/**
 * The packages the tree and the game must share one copy of, with any subpath: two Pixis or two
 * cores break the game.
 */
const SHARED_IMPORT = /^(?:pixi\.js|@moku-labs\/(?:core|common))(?:\/.*)?$/;

/**
 * Lists the entries of the tree, from the `exports` of its package.json: `"."` is `index`,
 * `"./app/page"` is `app/page`. A pattern export (`./fonts/*`) is a folder of files, not an entry.
 *
 * @returns The entry names, such as `["index", "testing", "visual"]`.
 */
export function treeEntries(): string[] {
  const manifest = JSON.parse(readFileSync(path.join(treeRoot, "package.json"), "utf8")) as {
    exports: Record<string, unknown>;
  };

  return Object.keys(manifest.exports)
    .filter(key => !key.includes("*"))
    .map(key => (key === "." ? "index" : key.slice(2)));
}

/**
 * The source file of one entry in the tree.
 *
 * @param entry - The entry name, `index` for the package root, `/` separated.
 * @returns The absolute path of the `.ts` file.
 */
export function entrySource(entry: string): string {
  return path.join(treeRoot, "src", ...`${entry}.ts`.split("/"));
}

/**
 * Maps an import of the engine to its entry name.
 *
 * @param specifier - The import.
 * @returns The entry name, or `undefined` when the import is not the engine.
 * @example
 * ```ts
 * entryOf("@moku-labs/game/app/page"); // "app/page"
 * ```
 */
export function entryOf(specifier: string): string | undefined {
  if (specifier === "@moku-labs/game") return "index";

  return specifier.startsWith("@moku-labs/game/")
    ? specifier.slice("@moku-labs/game/".length)
    : undefined;
}

/**
 * Sends the engine's entries to the tree's source, and the tree's imports of the shared packages
 * to the game root.
 */
const treeBundle: TreePlugin = {
  name: "moku-game-tree",
  /**
   * Registers the resolve callbacks of the engine entries and of the shared packages.
   *
   * @param build - Bun's plugin builder.
   */
  setup(build) {
    const entries = new Set(treeEntries());
    const tree = `${treeRoot}${path.sep}`;
    const game = process.cwd();

    build.onResolve({ filter: ENGINE_IMPORT }, args => {
      const entry = entryOf(args.path);

      return entry !== undefined && entries.has(entry) ? { path: entrySource(entry) } : undefined;
    });
    build.onResolve({ filter: SHARED_IMPORT }, args =>
      args.importer.startsWith(tree) ? { path: Bun.resolveSync(args.path, game) } : undefined
    );
  }
};

export default treeBundle;
