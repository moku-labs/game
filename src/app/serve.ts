/**
 * @file `moku-game dev`: the game folder read and checked, the dev page written into
 * `<game>/.moku/`, the parent that re-runs the bin under the generated bunfig, and the child that
 * serves the page with `Bun.serve`. The hot plugin comes from the engine the game resolves, so
 * the game writes no bunfig, no HTML and no dev file. Node and Bun only: the bin bundles it.
 */
import {
  type Dirent,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { CliDeps, Signal, Watcher } from "./cli";
import { resolveConfig } from "./config";
import { bunfigText, devFlag, devMain, pageHtml } from "./generate";
import type { GameConfig, ResolvedGameConfig } from "./types";

/** What the dev page is written with besides the game. Every path is absolute. */
export type PrepareOptions = {
  /** Agent modules the dev page passes to `startPage`, in order: bare specifiers or absolute paths. */
  agents?: readonly string[];
  /** Files Bun preloads in the serving process. */
  preload?: readonly string[];
  /** Bun plugins the dev page bundles with, after the hot plugin. */
  servePlugins?: readonly string[];
};

/** The two files of the written dev page a Bun server needs. */
export type PageFiles = {
  /** `<game>/.moku/index.html`, the HTML the server imports. */
  html: string;
  /** `<game>/.moku/bunfig.toml`, the config the server runs under. */
  bunfig: string;
};

/** One `moku-game dev` run, its flags read and its paths absolute. */
export type ServeRun = {
  /** The game folder. */
  root: string;
  /** The port; `0` lets the system pick one. */
  port: number;
  /** Serve `<game>/dist/assets` instead of the raw game files. */
  packed: boolean;
  /** Files Bun preloads in the serving process. */
  preload: readonly string[];
  /** Extra Bun plugins of the dev page. */
  servePlugins: readonly string[];
};

/** The server of the dev page, the part `dev` and `visual` use. Bun's `Server` fits it. */
export type PageServer = {
  /** The bound address, with the port the system picked. */
  readonly url: URL;
  /**
   * Stops the server.
   *
   * @param closeActiveConnections - True to close the open connections too.
   * @returns Resolves when it stopped.
   */
  stop(closeActiveConnections?: boolean): Promise<void>;
};

/** The signals the dev parent hands to its child. */
const FORWARDED: readonly Signal[] = ["SIGINT", "SIGTERM", "SIGHUP"];

/** The signals that stop the dev child. */
const STOPPING: readonly Signal[] = ["SIGINT", "SIGTERM"];

/** How often the dev child checks that its parent still runs. */
const PARENT_CHECK_MS = 1000;

/** The folders a `.dev.ts` module is never looked for in. */
const NO_DEV_MODULES = /^(?:node_modules|dist|generated|tests|__tests__)$/;

/** A `.gitignore` line that keeps `.moku/` of its own folder out. */
const OWN_MOKU_LINE = /^\/?\.moku\/?$/;

/** A `.gitignore` line that keeps every `.moku/` below its folder out. */
const ANY_MOKU_LINE = /^(?:\*\*\/)?\.moku\/?$/;

/**
 * Tells whether a path is a file.
 *
 * @param file - The path.
 * @returns True for an existing file.
 */
function isFile(file: string): boolean {
  return statSync(file, { throwIfNoEntry: false })?.isFile() === true;
}

/**
 * Tells whether a path is a folder.
 *
 * @param folder - The path.
 * @returns True for an existing folder.
 */
function isFolder(folder: string): boolean {
  return statSync(folder, { throwIfNoEntry: false })?.isDirectory() === true;
}

/**
 * Checks that a game folder has its `config.ts`.
 *
 * @param root - The game folder, absolute.
 * @returns The path of `config.ts`.
 * @throws {Error} When the game has no `config.ts`.
 */
function configFileOf(root: string): string {
  const file = path.join(root, "config.ts");

  if (!isFile(file)) {
    throw new Error(
      `[game] moku-game: no config.ts in "${root}".\n  A game keeps its page, native, system, save and assets data there.`
    );
  }

  return file;
}

/**
 * Reads a game's `config.ts` and fills its defaults.
 *
 * @param root - The game folder, absolute.
 * @returns The resolved config.
 * @throws {Error} When the game has no `config.ts`, it has no default export, or a value is one
 *   TypeScript would refuse.
 */
export async function loadSettings(root: string): Promise<ResolvedGameConfig> {
  const file = configFileOf(root);
  const loaded = (await import(pathToFileURL(file).href)) as { default?: GameConfig };

  if (loaded.default === undefined) {
    throw new Error(
      `[game] moku-game: config.ts in "${root}" has no default export.\n  End it with: export default { page: { title: "…" } } satisfies GameConfig.`
    );
  }

  return resolveConfig(loaded.default);
}

/**
 * Checks that every icon the page names is a file of the game.
 *
 * @param root - The game folder.
 * @param page - The resolved page.
 * @throws {Error} When an icon is not a file in the game.
 */
function checkIcons(root: string, page: ResolvedGameConfig["page"]): void {
  for (const [name, file] of Object.entries(page.icons)) {
    if (file !== undefined && !isFile(path.join(root, file))) {
      throw new Error(`[game] moku-game: page.icons.${name} "${file}" is not a file in the game.`);
    }
  }
}

/**
 * Reads and checks a game folder for a page: `config.ts` and `index.ts` exist, the config
 * resolves and its icons are files of the game.
 *
 * @param root - The game folder, absolute.
 * @returns The resolved config.
 * @throws {Error} When `config.ts` or `index.ts` is missing, a config value is refused, or an icon
 *   is not a file in the game.
 */
export async function loadGame(root: string): Promise<ResolvedGameConfig> {
  configFileOf(root);

  if (!isFile(path.join(root, "index.ts"))) {
    throw new Error(
      `[game] moku-game: no index.ts in "${root}".\n  It default-exports defineGameApp({ ... }).`
    );
  }

  const settings = await loadSettings(root);

  checkIcons(root, settings.page);

  return settings;
}

/**
 * Checks that every file a flag names exists.
 *
 * @param flag - The flag, for the message.
 * @param files - The absolute paths.
 * @throws {Error} When a path is not a file.
 */
export function checkFiles(flag: "--preload" | "--serve-plugin", files: readonly string[]): void {
  const missing = files.find(file => !isFile(file));

  if (missing !== undefined) {
    throw new Error(`[game] moku-game: ${flag} "${missing}" is not a file.`);
  }
}

/**
 * Finds the hot plugin of the engine the game resolves: the installed `dist/hot.mjs`, or
 * `src/hot.ts` through the tsconfig `paths` of the engine repo.
 *
 * @param root - The game folder.
 * @param resolve - Bun's resolver.
 * @returns The absolute path of the plugin.
 * @throws {Error} When the game cannot resolve `@moku-labs/game/hot`.
 */
function hotPluginOf(root: string, resolve: CliDeps["resolve"]): string {
  try {
    return resolve("@moku-labs/game/hot", root);
  } catch (error) {
    throw new Error(
      `[game] dev: "@moku-labs/game/hot" does not resolve from "${root}".\n  Install @moku-labs/game in the game: bun add @moku-labs/game.`,
      { cause: error }
    );
  }
}

/**
 * Lists the files of the game's `tests/scenarios/` folder.
 *
 * @param root - The game folder.
 * @returns The file names, or none without the folder.
 */
function scenarioNamesOf(root: string): string[] {
  const folder = path.join(root, "tests", "scenarios");

  if (!isFolder(folder)) return [];

  return readdirSync(folder, { withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => entry.name);
}

/**
 * Tells whether the search for `.dev.ts` modules skips a folder: a dot folder, or a folder of
 * tools and tests.
 *
 * @param name - The folder name.
 * @returns True for a skipped folder.
 * @example
 * ```ts
 * isSkippedFolder("node_modules"); // true
 * ```
 */
function isSkippedFolder(name: string): boolean {
  return name.startsWith(".") || NO_DEV_MODULES.test(name);
}

/**
 * Lists the `.dev.ts` modules under a folder of the game, outside the dot folders and the folders
 * of tools and tests.
 *
 * @param root - The game folder.
 * @param relative - The folder under the game, `/` separated, `""` for the game itself.
 * @returns The modules, relative to the game, `/` separated.
 */
function devModulesOf(root: string, relative = ""): string[] {
  const entries: Dirent[] = readdirSync(path.join(root, relative), { withFileTypes: true });

  return entries.flatMap(entry => {
    const inGame = relative === "" ? entry.name : `${relative}/${entry.name}`;

    if (entry.isDirectory() && isSkippedFolder(entry.name)) return [];
    if (entry.isDirectory()) return devModulesOf(root, inGame);

    return entry.isFile() && entry.name.endsWith(".dev.ts") ? [inGame] : [];
  });
}

/**
 * Writes a file only when its text changed, so a second run wakes no watcher.
 *
 * @param file - The absolute path.
 * @param text - The text.
 */
function writeIfChanged(file: string, text: string): void {
  if (existsSync(file) && readFileSync(file, "utf8") === text) return;

  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
}

/**
 * The text of the dev `main.ts` for the game as it is on disk now.
 *
 * @param root - The game folder.
 * @param settings - The resolved config.
 * @param agents - The agent modules, when the page has any.
 * @returns The text.
 */
function mainOf(root: string, settings: ResolvedGameConfig, agents?: readonly string[]): string {
  const scenarios = scenarioNamesOf(root);

  return agents === undefined || agents.length === 0
    ? devMain(settings, { scenarios, devModules: [] })
    : devMain(settings, { scenarios, devModules: devModulesOf(root), agents });
}

/**
 * Writes the dev page of a checked game into `<game>/.moku/`: `index.html`, `dev.ts`, `main.ts`
 * and `bunfig.toml`. Every text is made before the first write, so a refused value writes
 * nothing.
 *
 * @param root - The game folder, absolute.
 * @param settings - The resolved config.
 * @param options - The agents, the preloads and the extra plugins, absolute.
 * @param resolve - Bun's resolver, to find the hot plugin.
 * @returns The paths of the HTML and the bunfig.
 * @throws {Error} When the hot plugin does not resolve, a preload or plugin is not a file, or a
 *   page value is refused.
 */
export function writePage(
  root: string,
  settings: ResolvedGameConfig,
  options: PrepareOptions,
  resolve: CliDeps["resolve"]
): PageFiles {
  const preload = options.preload ?? [];
  const servePlugins = options.servePlugins ?? [];

  checkFiles("--preload", preload);
  checkFiles("--serve-plugin", servePlugins);

  const folder = path.join(root, ".moku");
  const html = path.join(folder, "index.html");
  const bunfig = path.join(folder, "bunfig.toml");
  const texts: [string, string][] = [
    [html, pageHtml(settings.page, { toRoot: "../", script: "./main.ts" })],
    [path.join(folder, "dev.ts"), devFlag()],
    [path.join(folder, "main.ts"), mainOf(root, settings, options.agents)],
    [bunfig, bunfigText({ hotPlugin: hotPluginOf(root, resolve), servePlugins, preload })]
  ];

  for (const [file, text] of texts) writeIfChanged(file, text);

  return { html, bunfig };
}

/**
 * Reads and checks a game, then writes its dev page into `<game>/.moku/`. The editor's step and
 * the dev parent's step 3; it starts no server and no watcher.
 *
 * @param root - The game folder, absolute.
 * @param options - The agents, the preloads and the extra plugins, absolute.
 * @param resolve - Bun's resolver, to find the hot plugin.
 * @returns The paths of the HTML and the bunfig.
 * @throws {Error} The errors of `moku-game dev` before its server starts.
 */
export async function preparePageAt(
  root: string,
  options: PrepareOptions,
  resolve: CliDeps["resolve"]
): Promise<PageFiles> {
  return writePage(root, await loadGame(root), options, resolve);
}

/**
 * Tells whether a `.gitignore` of the folder or of a folder above it, up to the repository, keeps
 * the game's `.moku/` out of git.
 *
 * @param folder - The folder to read.
 * @param own - True for the game folder itself, where `/.moku` counts too.
 * @returns True when a line ignores `.moku/`.
 */
function ignoresMoku(folder: string, own = true): boolean {
  const file = path.join(folder, ".gitignore");
  const lines = isFile(file) ? readFileSync(file, "utf8").split(/\r?\n/u) : [];
  const pattern = own ? OWN_MOKU_LINE : ANY_MOKU_LINE;

  if (lines.some(line => pattern.test(line.trim()))) return true;

  const parent = path.dirname(folder);

  // The walk ends at the repository, or at the top of the disk.
  if (existsSync(path.join(folder, ".git")) || parent === folder) return false;

  return ignoresMoku(parent, false);
}

/**
 * Watches `tests/scenarios/` while the dev server runs: a file added or removed rewrites `main.ts`,
 * and Bun reloads the page with the new registry. An edit of a scenario needs nothing: Bun
 * watches the import itself.
 *
 * @param root - The game folder.
 * @param settings - The resolved config.
 * @param deps - The watcher and the console.
 * @returns The watcher, or `undefined` when the game has no scenario folder.
 */
function watchScenarios(
  root: string,
  settings: ResolvedGameConfig,
  deps: CliDeps
): Watcher | undefined {
  const folder = path.join(root, "tests", "scenarios");
  const main = path.join(root, ".moku", "main.ts");

  if (!isFolder(folder)) return undefined;

  return deps.watch(folder, event => {
    if (event !== "rename") return;

    try {
      writeIfChanged(main, mainOf(root, settings));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);

      deps.ui.warn(`[game] dev: main.ts was not rewritten: ${reason}.`);
    }
  });
}

/**
 * The command that runs the bin again as the dev child: the Bun under the page's bunfig, then
 * `dev` with the game, the port and `--packed`.
 *
 * @param run - The flags of the run.
 * @param page - The written page, for its bunfig.
 * @param deps - The Bun and the bin.
 * @returns The words of the command.
 */
function devChildCommand(run: ServeRun, page: PageFiles, deps: CliDeps): string[] {
  return [
    deps.execPath,
    `--config=${page.bunfig}`,
    ...deps.self,
    "dev",
    "--root",
    run.root,
    "--port",
    String(run.port),
    ...(run.packed ? ["--packed"] : [])
  ];
}

/**
 * The dev parent: checks the game, writes the page, re-runs the bin under the generated bunfig
 * with the game as its working directory, and watches the scenarios while the child runs. It
 * hands Ctrl+C and the other stop signals to the child and answers the child's exit code.
 *
 * @param run - The flags of the run.
 * @param deps - The process seams.
 * @returns The exit code of the child.
 * @throws {Error} When the game, a flag or the page is refused, or the child does not start.
 */
export async function serveParent(run: ServeRun, deps: CliDeps): Promise<number> {
  const settings = await loadGame(run.root);
  const hasPack = isFile(path.join(run.root, "dist", "assets", "manifest.json"));
  const hasManifest = isFile(path.join(run.root, "manifest.json"));

  // A packed run serves the pack, so it needs one; a raw run only warns without the dev manifest.
  if (run.packed && !hasPack) {
    throw new Error(
      `[game] dev: no packed build in "${path.join(run.root, "dist", "assets")}".\n  Run "moku-game pack" first.`
    );
  }

  if (!run.packed && !hasManifest) {
    deps.ui.warn(`[game] dev: no manifest.json in "${run.root}".\n  Run "moku-game keys" first.`);
  }

  // The page is written before the child imports it, into a folder git should not see.
  const page = writePage(run.root, settings, run, deps.resolve);

  if (!ignoresMoku(run.root)) {
    deps.ui.warn('[game] dev: add ".moku/" to .gitignore. moku-game writes its dev page there.');
  }

  // The child serves the page from the game folder in its own process group: Ctrl+C reaches the
  // parent, which hands it on.
  const child = deps.spawn(devChildCommand(run, page, deps), {
    cwd: run.root,
    env: { ...deps.env, MOKU_GAME_CHILD: "1" },
    stdio: ["inherit", "inherit", "inherit"],
    detached: true
  });
  const removers = FORWARDED.map(signal => deps.onSignal(signal, () => child.kill(signal)));
  let watcher: Watcher | undefined;

  // The scenario watcher lives exactly as long as the child: it opens once the child runs and
  // closes when it exits.
  try {
    watcher = watchScenarios(run.root, settings, deps);

    return await child.exited;
  } finally {
    watcher?.close();
    for (const remove of removers) remove();
  }
}

/**
 * The path of a request under the served folder: decoded, so the `%7B` braces of a nine-slice
 * name work, and refused when it could leave the folder or reach a hidden or installed file.
 *
 * @param base - The served folder.
 * @param pathname - The path of the request URL.
 * @returns The absolute file path, or `undefined` for a refused path.
 * @example
 * ```ts
 * staticPath("/g", "/features/ui/assets/%7Bbutton%7D.png"); // "/g/features/ui/assets/{button}.png"
 * ```
 */
export function staticPath(base: string, pathname: string): string | undefined {
  const decoded = safeDecode(pathname);

  if (decoded === undefined || decoded.includes("\0") || decoded.includes("\\")) return undefined;

  const segments = decoded.split("/").filter(segment => segment !== "");
  const refused = segments.some(segment => segment.startsWith(".") || segment === "node_modules");

  return refused ? undefined : path.join(base, ...segments);
}

/**
 * Decodes a percent-encoded path.
 *
 * @param pathname - The encoded path.
 * @returns The decoded path, or `undefined` when an escape is broken.
 * @example
 * ```ts
 * safeDecode("/a%E0"); // undefined
 * ```
 */
function safeDecode(pathname: string): string | undefined {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return undefined;
  }
}

/**
 * Answers a request with a file, or a 404 for a missing or empty one.
 *
 * @param file - The absolute path, or `undefined` for a refused path.
 * @returns The response.
 */
function fileResponse(file: string | undefined): Response {
  const found = file === undefined ? undefined : statSync(file, { throwIfNoEntry: false });
  const isServable = file !== undefined && found?.isFile() === true && found.size > 0;

  return isServable ? new Response(Bun.file(file)) : new Response("Not found", { status: 404 });
}

/**
 * Starts the dev server on `127.0.0.1` only, never on every interface: the page on `/`, the
 * manifest of the served folder on `/manifest.json`, and its files as static files. The dev child
 * and `moku-game visual` serve the page with it.
 *
 * @param run - The flags of the run.
 * @param page - The page bundle the process imported.
 * @returns The server.
 * @throws {Error} When the port is in use.
 */
export function serveOn(run: ServeRun, page: Response | Bun.HTMLBundle): PageServer {
  const base = run.packed ? path.join(run.root, "dist", "assets") : run.root;

  try {
    return Bun.serve({
      hostname: "127.0.0.1",
      port: run.port,
      development: true,
      routes: {
        "/": page,
        "/manifest.json": () => fileResponse(path.join(base, "manifest.json"))
      },
      fetch: request => fileResponse(staticPath(base, new URL(request.url).pathname))
    });
  } catch (error) {
    if ((error as { code?: unknown }).code === "EADDRINUSE") {
      throw new Error(`[game] dev: port ${run.port} is in use.\n  Pass --port 0 for a free port.`, {
        cause: error
      });
    }

    throw error;
  }
}

/**
 * Waits until the dev child should stop: Ctrl+C, a stop signal, or a parent that died (its
 * parent id changed). Then stops the server.
 *
 * @param server - The running server.
 * @param deps - The signal seam.
 * @returns Resolves to the exit code `0` once the server stopped.
 */
function untilStopped(server: PageServer, deps: CliDeps): Promise<number> {
  const parent = process.ppid;

  return new Promise(resolve => {
    const removers: (() => void)[] = [];
    // A parent that died hands the child to another process: the parent id changes.
    const timer = setInterval(() => {
      if (process.ppid !== parent) stop();
    }, PARENT_CHECK_MS);
    // Every cause stops the same way: no more checks, no more listeners, then the server.
    const stop = (): void => {
      clearInterval(timer);
      for (const remove of removers.splice(0)) remove();
      resolve(server.stop(true).then(() => 0));
    };

    // Ctrl+C and SIGTERM stop the child; SIGHUP is the parent's to hand on.
    for (const signal of STOPPING) removers.push(deps.onSignal(signal, stop));
  });
}

/**
 * The dev child, under the generated bunfig in the game folder: imports the written page, serves
 * it, prints the bound URL on its own plain line, and runs until it is stopped.
 *
 * @param run - The flags of the run.
 * @param deps - The process seams.
 * @returns The exit code `0` once stopped.
 * @throws {Error} When the port is in use.
 */
export async function serveChild(run: ServeRun, deps: CliDeps): Promise<number> {
  const page = await deps.loadPage(path.join(run.root, ".moku", "index.html"));
  const server = serveOn(run, page.default);
  const assets = run.packed ? "packed build" : "raw assets";

  deps.ui.info(`${path.basename(run.root)}: dev server, ${assets}. Ctrl+C stops it.`);
  deps.ui.line(server.url.href);

  return untilStopped(server, deps);
}
