/**
 * @file Hot entry (subpath `./hot`): the Bun plugin of the dev server that hot swaps the views of
 * a running game. It appends a footer to every view module it loads: the module accepts its own
 * update and hands the new exports to the running game through `globalThis.__moku_hot`. The `ui`
 * plugin installs that handler in dev builds only. What swaps: styles, components, projections,
 * animations, text styles, emitters and generated strings. A view module is a `.tsx` file, a
 * `styles.ts`, a `view.ts`, an `animations.ts`, an `effects.ts` or a generated
 * `generated/strings.<locale>.ts`; a logic module never gets the footer, so its save reaches the
 * root and the page reloads and restores its state. The plugin lives in `[serve.static]` of
 * `bunfig.toml`, the dev server only: `Bun.build` of a production build never loads it.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Which files get the hot swap footer. A file has to match `include` and must not match
 * `exclude`. Only the game's own files can get it: the game root is the working directory of
 * the dev server, and a file outside it (the engine source, a linked package) always loads
 * unchanged.
 *
 * @example
 * ```ts
 * // A game keeps its views in `look/` folders instead of `.tsx` files.
 * const options: HotOptions = { include: /\/look\/.*\.ts$/ };
 * ```
 */
export type HotOptions = {
  /**
   * The files that get the footer. Default: `.tsx` files, `styles.ts`, `view.ts`,
   * `animations.ts`, `effects.ts` and `generated/strings.<locale>.ts`. Bun runs it as the load
   * filter on the absolute path, so it should not anchor at the start.
   */
  include?: RegExp;
  /**
   * The files that load unchanged although they match `include`. Default: anything under
   * `node_modules/`, `web/`, `generated/`, `__tests__/` or `tests/`, and `.test`/`.spec` files.
   * Tested on the path relative to the game root with a leading `/` and `/` separators, also on
   * Windows: `/features/home/view.tsx`. A folder above the game root never excludes a file. A
   * `generated/strings.<locale>.ts` file is never excluded: the generated strings swap.
   */
  exclude?: RegExp;
};

/**
 * The part of Bun's plugin builder the hot plugin uses. Bun's `PluginBuilder` fits it, so the
 * shipped types need no `bun` import.
 */
export type HotBuild = {
  /**
   * Registers a load callback for the files whose path matches `filter`.
   *
   * @param options - The filter on the absolute path of a module.
   * @param options.filter - Only a path that matches it loads through the callback.
   * @param callback - Reads the module and returns its source and loader.
   */
  onLoad(
    options: { filter: RegExp },
    callback: (args: { path: string }) => Promise<{ contents: string; loader: "ts" | "tsx" }>
  ): void;
};

/**
 * A Bun plugin object, as `[serve.static] plugins` in `bunfig.toml` loads it.
 */
export type HotPlugin = {
  /** The plugin name Bun reports in its errors. */
  name: string;
  /**
   * Registers the load callback that appends the footer.
   *
   * @param build - Bun's plugin builder.
   */
  setup(build: HotBuild): void;
};

/**
 * The default view modules: `.tsx` files, `styles.ts`, `view.ts`, `animations.ts`, `effects.ts`
 * and the generated strings of a locale.
 */
const DEFAULT_INCLUDE =
  /(\.tsx|\/styles\.ts|\/view\.ts|\/animations\.ts|\/effects\.ts|\/generated\/strings\.[\w-]+\.ts)$/;

/** The generated strings of one locale, the one file under `generated/` that swaps. */
const STRINGS = /\/generated\/strings\.[\w-]+\.ts$/;

/** The default folders and test files that never hot swap. The outer group only scopes the `$`. */
const DEFAULT_EXCLUDE = /(\/(node_modules|web|generated|__tests__|tests)\/|\.(test|spec)\.tsx?$)/;

/**
 * Gives the path of a module relative to the game root, the working directory of the dev server.
 *
 * @param file - The absolute path of the module.
 * @param root - The game root.
 * @returns The path with a leading `/` and `/` separators, or `undefined` outside the game root.
 * @example
 * ```ts
 * gamePath("/work/tests/game/features/home/view.tsx", "/work/tests/game"); // "/features/home/view.tsx"
 * ```
 */
function gamePath(file: string, root: string): string | undefined {
  const inGame = path.relative(root, file).replaceAll("\\", "/");

  // Another Windows drive gives an absolute path back.
  if (inGame.startsWith("../") || path.isAbsolute(inGame)) return undefined;

  return `/${inGame}`;
}

/**
 * Builds the footer that makes a module accept its own update and hand it to the running game.
 * Bun only sees `import.meta.hot.accept(...)` written out in full, so the footer never aliases it.
 *
 * @param file - The absolute path of the module.
 * @returns The footer source, one line per statement.
 * @example
 * ```ts
 * footerOf("/game/features/home/view.tsx").includes('swap(next, "/game/features/home/view.tsx");'); // true
 * ```
 */
function footerOf(file: string): string {
  return [
    "if (import.meta.hot) {",
    "  import.meta.hot.accept();",
    "  import.meta.hot.accept(next => {",
    "    const swap = globalThis.__moku_hot;",
    String.raw`    if (typeof swap !== "function") throw new Error("[game] No running game takes the hot swap.\n  Open the game page, then save again.");`,
    `    swap(next, ${JSON.stringify(file)});`,
    "  });",
    "}",
    ""
  ].join("\n");
}

/**
 * Creates the Bun plugin that hot swaps the views of a running game in the dev server. The
 * default export is `hot()`; call it with options for another folder layout. The dev server runs
 * in the game root: `exclude` is tested on the path relative to it, and a file outside it loads
 * unchanged.
 *
 * @param options - The files that get the footer; both filters have defaults.
 * @returns The Bun plugin object.
 * @example
 * ```ts
 * // bunfig.toml of a game with the default layout:
 * //   [serve.static]
 * //   plugins = ["@moku-labs/game/hot"]
 * // A game that keeps its views in `look/` folders exports its own plugin from `hot.ts`
 * // and lists `plugins = ["./hot.ts"]` instead:
 * export default hot({ include: /\/look\/.*\.ts$/ });
 * ```
 */
export function hot(options: HotOptions = {}): HotPlugin {
  const include = options.include ?? DEFAULT_INCLUDE;
  const exclude = options.exclude ?? DEFAULT_EXCLUDE;

  return {
    name: "@moku-labs/game/hot",
    setup: build => {
      build.onLoad({ filter: include }, async ({ path: file }) => {
        // Read the module and pick the loader from its extension.
        const source = await readFile(file, "utf8");
        const loader = file.endsWith(".tsx") ? "tsx" : "ts";

        // A file outside the game, or an excluded one that is not generated strings, loads unchanged.
        const inGame = gamePath(file, process.cwd());
        const strings = STRINGS.test(inGame ?? "");
        const unchanged = inGame === undefined || (!strings && exclude.test(inGame));

        if (unchanged) return { contents: source, loader };

        // Any other file gets the footer that hands its new exports to the running game.
        return { contents: `${source}\n${footerOf(file)}`, loader };
      });
    }
  };
}

/** The Bun plugin with the default filters, for `plugins = ["@moku-labs/game/hot"]` in `bunfig.toml`. */
export default hot();
