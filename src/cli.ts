/**
 * @file The `@moku-labs/game/cli` door, node and bun only: the `moku-game` bin and the editor's
 * seam. `runCli` runs one command line of `moku-game` (dev, build, native, keys, pack, help) in
 * this process; `preparePage` writes a game's dev page into `<game>/.moku/` for a server the
 * caller starts itself, as the editor does. It imports no Pixi, and the root entry never imports
 * it. The code lives in `app/`; this file wires the real process into it.
 */
import { watch } from "node:fs";
import path from "node:path";
import { createBrandConsole } from "@moku-labs/common/cli";
import { type CliDeps, runCommand } from "./app/cli";
import { runNative } from "./app/native";
import { preparePageAt } from "./app/serve";
import { compileStrings, exportStrings, importStrings, runCli as runAssets } from "./assets";

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
 * The real process behind the command line: the branded console, the environment the bin
 * started with, Bun's spawn and resolver, the signals, `fs.watch`, the asset scanner with the
 * string tools, and native.
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
    assets: argv => runAssets(argv, { compile: compileStrings, exportStrings, importStrings }, ui),
    native: runNative,
    resolve: (specifier, from) => Bun.resolveSync(specifier, from),
    loadPage: file => import(file)
  };
}

/**
 * Runs one `moku-game` command line in this process: `dev`, `build`, `native <verb>`, `keys`,
 * `pack` or `help`, with `--root`, `--preload` and `--serve-plugin` before or after the command
 * word. Every line goes through the branded console; nothing exits the process.
 *
 * @param argv - The arguments after the bin.
 * @returns The exit code.
 * @example
 * ```ts
 * // bin/moku-game.mjs in a game folder:
 * await runCli(["dev", "--port", "0"]); // 0 after Ctrl+C; stdout had "http://localhost:<port>/"
 * await runCli(["help"]); // 0
 * ```
 */
export async function runCli(argv: readonly string[]): Promise<number> {
  return runCommand(argv, processDeps());
}

/**
 * Writes a game's dev page into `<root>/.moku/` for a server the caller starts: `index.html`,
 * `dev.ts`, `main.ts` with the scenarios of `tests/scenarios/` (and, with agents, the agents and
 * the game's `.dev` modules), and `bunfig.toml` with the engine's hot plugin. It starts no server
 * and no watcher, and throws the `[game]` errors of `moku-game dev`.
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
