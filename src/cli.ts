/**
 * @file The `@moku-labs/game/cli` door, node and bun only: the `moku-game` bin and the editor's
 * seam. `runCli` runs one command line of `moku-game` (dev, build, native, keys, pack, visual,
 * help) in this process; `preparePage` writes a game's dev page into `<game>/.moku/` for a server the
 * caller starts itself, as the editor does, and `watchKeys` keeps the game's `generated/` fresh
 * while that page is open. It imports no Pixi, and the root entry never imports it. The code
 * lives in `app/`; this file wires the real process into it.
 */
import { watch } from "node:fs";
import path from "node:path";
import { createBrandConsole } from "@moku-labs/common/cli";
import { type CliDeps, runCommand } from "./app/cli";
import {
  type KeysSeams,
  type KeysUi,
  type KeysWatcher,
  type WatchKeysOptions,
  watchKeysAt
} from "./app/keys";
import { runNative } from "./app/native";
import { loadGame, preparePageAt } from "./app/serve";
import { compileStrings, exportStrings, importStrings, runCli as runAssets } from "./assets";

export type { KeysWatcher, WatchKeysOptions } from "./app/keys";

/**
 * What the dev page of `preparePage` is written with besides the game.
 *
 * @example
 * ```ts
 * // The editor against an engine working tree: its agent on the page, the tree's recipe in Bun.
 * const options: PreparePageOptions = {
 *   agents: ["@moku-labs/editor/agent/page"],
 *   preload: ["../engine/scripts/tree/preload.ts"],
 *   servePlugins: ["../engine/scripts/tree/bundle.ts"]
 * };
 * ```
 */
export type PreparePageOptions = {
  /** Agent modules the dev page passes to startPage, in order. Each default-exports a PageAgent. Bare specifiers or absolute paths. */
  agents?: readonly string[];
  /** Files Bun preloads in the serving process. Relative paths resolve against the cwd. */
  preload?: readonly string[];
  /** Bun plugins the dev page bundles with, after the hot plugin. Relative paths resolve against the cwd. */
  servePlugins?: readonly string[];
};

/**
 * The written dev page: what a Bun server imports, and the config it runs under.
 *
 * @example
 * ```ts
 * // The editor re-runs itself under the page's bunfig, in the game folder.
 * const { html, bunfig } = await preparePage("games/timber");
 * Bun.spawn([process.execPath, `--config=${bunfig}`, Bun.main, html, "--root", "games/timber"], { cwd: "games/timber" });
 * ```
 */
export type PreparedPage = {
  /** Absolute path of `<root>/.moku/index.html`: the HTML a Bun server imports. */
  html: string;
  /** Absolute path of `<root>/.moku/bunfig.toml`: pass it as `bun --config=<bunfig>`. */
  bunfig: string;
};

/**
 * Runs the asset scanner's command line with the string tools of i18n: the scan behind
 * `moku-game keys`, `pack`, and the keys watch.
 *
 * @param argv - The flags of the scanner.
 * @param ui - Where its lines go.
 * @returns The exit code of the scanner.
 */
function runScanner(argv: string[], ui: KeysUi): Promise<number> {
  return runAssets(argv, { compile: compileStrings, exportStrings, importStrings }, ui);
}

/**
 * The real seams of the keys watch: the asset scanner with the string tools, as `moku-game keys`
 * runs it, `fs.watch`, and the console.
 *
 * @param ui - The console of the process.
 * @returns The seams.
 */
function keysSeams(ui: KeysUi): KeysSeams {
  return { scan: runScanner, watch, ui };
}

/**
 * The real process behind the command line: the branded console, the environment the bin
 * started with, Bun's spawn and resolver, the signals, `fs.watch`, the keys watch, the asset
 * scanner with the string tools, native, and the visual test runner, loaded only by
 * `moku-game visual`.
 *
 * @returns The seams of this process.
 */
function processDeps(): CliDeps {
  // The bin's own process, read once and handed to its child.
  const env = { ...process.env }; // @env-allow: the bin's own process, handed to its child
  const ui = createBrandConsole();

  // The mark of a re-run is for this process only: a moku-game that native's Tauri shell starts
  // again for the web build is a fresh run.
  Reflect.deleteProperty(process.env, "MOKU_GAME_CHILD"); // @env-allow: the mark is not inherited

  return {
    ui,
    env,
    cwd: process.cwd(),
    execPath: process.execPath,
    self: [Bun.main],
    spawn: (command, options) => Bun.spawn(command, options),
    onSignal: (signal, handler) => {
      process.on(signal, handler);

      return () => {
        process.off(signal, handler);
      };
    },
    watch: (folder, listener) => {
      const watcher = watch(folder, event => listener(event));

      // A watched folder that disappears ends the watch; the dev server runs on.
      watcher.on("error", () => watcher.close());

      return watcher;
    },
    watchKeys: (root, settings) => watchKeysAt(root, settings, keysSeams(ui)),
    assets: argv => runScanner(argv, ui),
    native: runNative,
    resolve: (specifier, from) => Bun.resolveSync(specifier, from),
    loadPage: file => import(file),
    visual: () => import("./visual")
  };
}

/**
 * Runs one `moku-game` command line in this process: `dev`, `build`, `native <verb>`, `keys`,
 * `pack`, `visual` or `help`, with `--root`, `--preload` and `--serve-plugin` before or after the
 * command word. Every line goes through the branded console; nothing exits the process.
 *
 * @param argv - The arguments after the bin.
 * @returns The exit code.
 * @example
 * ```ts
 * // bin/moku-game.mjs in a game folder:
 * await runCli(["dev", "--port", "0"]); // 0 after Ctrl+C; stdout had "http://localhost:<port>/"
 * await runCli(["visual", "--no-pixels"]); // 0 when every checkpoint of tests/visual/index.ts is the same
 * await runCli(["help"]); // 0
 * ```
 */
export async function runCli(argv: readonly string[]): Promise<number> {
  return runCommand(argv, processDeps());
}

/**
 * Writes a game's dev page into `<root>/.moku/` for a server the caller starts: `index.html`,
 * `dev.ts`, `main.ts` with the scenarios of `tests/scenarios/` (and, with agents, the agents and
 * the game's `.dev` modules), and `bunfig.toml` with the engine's hot plugin. It also writes the
 * first `assets-stamp.ts`, the empty one, when the game has none: `main.ts` imports it, and
 * `watchKeys` rewrites it when an asset file changes. The page accepts the new stamp: new bytes
 * of a file swap in place, a new or removed file reloads the page. It starts no server and no
 * watcher, and throws the `[game]` errors of `moku-game dev`.
 *
 * @param root - The game folder, relative to the cwd or absolute.
 * @param options - The agents, the preloads and the extra bundler plugins.
 * @returns The absolute paths of the HTML and the bunfig.
 * @throws {Error} When the game has no `config.ts` or `index.ts`, a config value is refused, the
 *   game does not resolve `@moku-labs/game/hot`, or a preload or plugin is not a file.
 * @example
 * ```ts
 * // The editor bin, started with --root games/timber:
 * const { preparePage } = await import(Bun.resolveSync("@moku-labs/game/cli", root));
 * await preparePage("games/timber", { agents: ["@moku-labs/editor/agent/page"] });
 * // { html: "<cwd>/games/timber/.moku/index.html", bunfig: "<cwd>/games/timber/.moku/bunfig.toml" }
 * ```
 */
export async function preparePage(
  root: string,
  options: PreparePageOptions = {}
): Promise<PreparedPage> {
  const absolute = (files: readonly string[] | undefined): string[] =>
    (files ?? []).map(file => path.resolve(file));

  return preparePageAt(
    path.resolve(root),
    {
      ...(options.agents === undefined ? {} : { agents: options.agents }),
      preload: absolute(options.preload),
      servePlugins: absolute(options.servePlugins)
    },
    (specifier, from) => Bun.resolveSync(specifier, from)
  );
}

/**
 * Keeps `generated/` of a game fresh while its dev page is open, for a server the caller runs:
 * the editor calls it next to `preparePage`, and raw `moku-game dev` runs the same watch itself.
 * It watches the game folder, runs the scan of `moku-game keys` once and resolves after it. Then
 * a save of an asset file (`.png`, `.webp`, `.fnt`, `.mp3`, `.m4a`) or of a
 * `strings/<locale>.json` scans again, with the same flags, outputs and layers; an output that
 * did not change is not rewritten. On the page a rewritten `generated/strings.<locale>.ts` hot
 * swaps. An asset file that is new, gone or saved again rewrites `.moku/assets-stamp.ts`, which
 * the page imports and accepts as a hot swap: the new bytes of a file swap in place in the loaded
 * bundles, with no reload, and a new or removed file reloads the page. A failed scan goes to
 * `onError` and the watch goes on, the first scan too. The layers of `config.ts` are read once:
 * a changed layer needs a new `watchKeys`.
 *
 * @param root - The game folder, relative to the cwd or absolute.
 * @param options - Where the message of a failed scan goes.
 * @returns The running watch; `close()` stops it.
 * @throws {Error} When the game has no `config.ts` or `index.ts`, or a config value is refused.
 * @example
 * ```ts
 * // The editor bin, next to preparePage, started with --root games/timber:
 * const { preparePage, watchKeys } = await import(Bun.resolveSync("@moku-labs/game/cli", root));
 * await preparePage("games/timber", { agents: ["@moku-labs/editor/agent/page"] });
 * const keys = await watchKeys("games/timber", { onError: message => log.warn(message) });
 * // generated/ is fresh; a save of features/home/strings/en.json rewrites generated/strings.en.ts
 * keys.close(); // when the editor closes the game
 * ```
 */
export async function watchKeys(
  root: string,
  options: WatchKeysOptions = {}
): Promise<KeysWatcher> {
  const game = path.resolve(root);

  return watchKeysAt(game, await loadGame(game), keysSeams(createBrandConsole()), options);
}
