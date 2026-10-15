/**
 * @file `moku-game build`: the assets packed with the config's layers, then the production page
 * bundled by `Bun.build` in the game folder, with its HTML, `main.ts` and `script.ts` in memory
 * under a virtual `<game>/.moku/build/` that is never written, then the packed assets copied
 * beside the page. A release page that carries the editor's agent is refused and removed. With
 * `--debug` the page is a debug page instead: the editor's page agent, the game's `.dev` modules,
 * the agent flag and a control profile, a marked title and a build id. The output works from any
 * http sub-path and from the Tauri protocol: every link starts with `./`, and the page reads
 * `manifest.json` next to itself. Node and Bun only: the bin bundles it.
 */
import {
  constants,
  copyFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { BunPlugin } from "bun";
import { findFeatureOwners } from "../project/features";
import type { CliDeps } from "./cli";
import { type EngineFingerprint, engineFingerprint, engineLine } from "./engine";
import { agentFlag, buildMain, DEBUG_AGENT, debugMain, pageHtml, scriptMark } from "./generate";
import { DEV_MANIFEST, devModulesOf, hotPluginOf, loadGame } from "./serve";
import type { ResolvedGameConfig } from "./types";

/**
 * The control profile of a debug page: `read` runs the read and cosmetic commands, `full` every
 * command.
 *
 * @example
 * ```ts
 * // moku-game build --debug=full
 * const level: DebugLevel = "full";
 * ```
 */
export type DebugLevel = "read" | "full";

/** One `moku-game build` run, its flags read and its paths absolute. */
export type BuildRun = {
  /** The game folder. */
  root: string;
  /** The output folder, replaced by the run. */
  out: string;
  /** Bun plugins the page bundles with. */
  servePlugins: readonly string[];
  /** Absent: a release page. `read` or `full`: a debug page with the editor agent and that control profile. */
  debug?: DebugLevel;
  /** The `host:port` the page agent dials; debug only, `editorOf` already applied the default. */
  editor?: string;
};

/** What a debug page is built with: its profile, its build id, the engine id and the editor address. */
type DebugPage = { level: DebugLevel; build: string; engine: string; editor: string };

/** The address the page agent of a debug page dials without `--editor`. */
export const DEFAULT_EDITOR = "127.0.0.1:47600";

/**
 * The two strings the editor's agent bundle always carries: the bridge's default path and the
 * prefix of every editor error. A contract between the engine, the editor and `@moku-labs/native`.
 */
const AGENT_MARKERS = ["/__editor/hello", "[moku-editor]"] as const;

/** The link prefix of the in-memory page, two folders under the game. */
const TO_ROOT = "../../";

/** Bytes in a kilobyte, for the size line of a run. */
const BYTES_PER_KB = 1024;

/**
 * The scan flags of a game: its root, its key module and one `--layer` per config layer.
 *
 * @param root - The game folder.
 * @param settings - The resolved config.
 * @returns The flags.
 * @example
 * ```ts
 * scanArguments("/g", resolveConfig({ page: { title: "T" }, assets: { layers: { shared: "ui" } } })).slice(4); // ["--layer", "shared=ui"]
 * ```
 */
function scanArguments(root: string, settings: ResolvedGameConfig): string[] {
  const layers = Object.entries(settings.assets.layers).flatMap(([folder, name]) => [
    "--layer",
    `${folder}=${name}`
  ]);

  return ["--root", root, "--keys", path.join(root, "generated", "assets.ts"), ...layers];
}

/**
 * The folders of every feature owner of a game, at any depth (`src/project/features.ts`). A
 * feature name two folders share counts as no owner: the scan that follows finds the same clash
 * and reports it.
 *
 * @param root - The game folder.
 * @returns Their absolute paths; none when the features folder is missing.
 */
function featureFolders(root: string): string[] {
  try {
    return findFeatureOwners(root).map(owner => path.join(root, owner.dir));
  } catch {
    return [];
  }
}

/**
 * Tells whether a game has an English string file to derive the pseudo-locale from: a
 * `strings/en.json` in a feature folder at any depth (a feature owner of
 * `src/project/features.ts`) or in a layer folder of the config.
 *
 * @param root - The game folder.
 * @param settings - The resolved config, for its layer folders.
 * @returns True when at least one such file exists.
 */
function hasEnglishStrings(root: string, settings: ResolvedGameConfig): boolean {
  // Strings live in each feature folder and in each layer folder the config names.
  const layerFolders = Object.keys(settings.assets.layers).map(folder => path.join(root, folder));

  // One English file is enough: the pseudo-locale is derived from English.
  return [...featureFolders(root), ...layerFolders].some(
    folder =>
      statSync(path.join(folder, "strings", "en.json"), { throwIfNoEntry: false })?.isFile() ===
      true
  );
}

/**
 * The flags of the asset scan for `moku-game keys`: the dev manifest in `generated/`, the
 * pseudo-locale when the game has an English string file, and `--check` for a check run.
 *
 * @param root - The game folder.
 * @param settings - The resolved config.
 * @param check - True to check instead of write.
 * @returns The flags for the scanner's command line.
 * @example
 * ```ts
 * keysArguments("/g", resolveConfig({ page: { title: "T" } }), true).slice(4); // ["--manifest", "/g/generated/manifest.json", "--check"]: no strings
 * keysArguments("/g", resolveConfig({ page: { title: "T" } }), false).at(-1); // "--pseudo" once /g/features/home/strings/en.json exists
 * ```
 */
export function keysArguments(
  root: string,
  settings: ResolvedGameConfig,
  check: boolean
): string[] {
  return [
    ...scanArguments(root, settings),
    "--manifest",
    path.join(root, DEV_MANIFEST),
    ...(hasEnglishStrings(root, settings) ? ["--pseudo"] : []),
    ...(check ? ["--check"] : [])
  ];
}

/**
 * The flags of the asset scan for `moku-game pack` and the first step of `build`: the pack into
 * `<game>/dist/assets`, and `--no-cache` for a cold run.
 *
 * @param root - The game folder.
 * @param settings - The resolved config.
 * @param noCache - True to pack without the cache.
 * @returns The flags for the scanner's command line.
 * @example
 * ```ts
 * packArguments("/g", resolveConfig({ page: { title: "T" } }), false).slice(4); // ["--pack", "/g/dist/assets"]
 * ```
 */
export function packArguments(
  root: string,
  settings: ResolvedGameConfig,
  noCache: boolean
): string[] {
  return [
    ...scanArguments(root, settings),
    "--pack",
    path.join(root, "dist", "assets"),
    ...(noCache ? ["--no-cache"] : [])
  ];
}

/**
 * Tells whether a folder is another folder or lies inside it.
 *
 * @param folder - The folder that may sit inside.
 * @param outer - The outer folder.
 * @returns True when `folder` is `outer` or lies under it.
 * @example
 * ```ts
 * isInside("/g", "/g/dist/web"); // false
 * ```
 */
function isInside(folder: string, outer: string): boolean {
  const relative = path.relative(outer, folder);
  const climbs = relative === ".." || relative.startsWith(`..${path.sep}`);

  return relative === "" || (!climbs && !path.isAbsolute(relative));
}

/**
 * Refuses an output folder whose removal would take the game or its packed assets with it. Inside
 * the game, only a folder under `dist` is the build's.
 *
 * @param root - The game folder.
 * @param out - The output folder.
 * @throws {Error} When the folder is the game, holds it, is, holds or lies in the pack, or lies in
 *   the game outside `dist`.
 */
function refuseOut(root: string, out: string): void {
  const pack = path.join(root, "dist", "assets");
  const replacesGame = isInside(root, out);
  const touchesPack = isInside(out, pack) || isInside(pack, out);
  const outsideBuildFolder = isInside(out, root) && !isInside(out, path.join(root, "dist"));
  const refused = replacesGame || touchesPack || outsideBuildFolder;

  if (refused) {
    throw new Error(
      `[game] build: --out "${out}" would replace the game or its packed assets. Name another folder.`
    );
  }
}

/**
 * Tells whether a default export is a Bun plugin.
 *
 * @param value - The default export.
 * @returns True for an object with a name and a `setup` function.
 */
function isBunPlugin(value: unknown): value is BunPlugin {
  return (
    typeof value === "object" &&
    value !== null &&
    "name" in value &&
    typeof value.name === "string" &&
    "setup" in value &&
    typeof value.setup === "function"
  );
}

/**
 * Imports the `--serve-plugin` files and takes their default exports.
 *
 * @param files - The absolute paths.
 * @returns The plugins, in order.
 * @throws {Error} When a file default-exports no Bun plugin.
 */
async function loadPlugins(files: readonly string[]): Promise<BunPlugin[]> {
  return Promise.all(
    files.map(async file => {
      const loaded = (await import(pathToFileURL(file).href)) as { default?: unknown };

      if (!isBunPlugin(loaded.default)) {
        throw new Error(
          `[game] build: --serve-plugin "${file}" default-exports no Bun plugin.\n  End it with: export default { name, setup(build) { … } }.`
        );
      }

      return loaded.default;
    })
  );
}

/**
 * The id of a debug build: the profile and the UTC time of the run, `YYYYMMDDTHHMMSSZ`.
 *
 * @param debug - The profile.
 * @param now - The wall-clock time of the run, ms.
 * @returns The id.
 * @example
 * ```ts
 * buildIdOf("read", Date.UTC(2026, 9, 14, 15, 30, 12)); // "debug-20261014T153012Z"
 * ```
 */
export function buildIdOf(debug: DebugLevel, now: number): string {
  const stamp = `${new Date(now).toISOString().slice(0, 19).replaceAll(/[-:]/g, "")}Z`;

  return debug === "full" ? `debug-full-${stamp}` : `debug-${stamp}`;
}

/**
 * The `define` map of a page: a release page defines the three flags `false`; a debug page the
 * dev flag `false`, the agent flag `true`, the control flag of its profile, and the build id, the
 * engine id and the editor address as strings.
 *
 * @param page - What a debug page is built with; `undefined` for a release page.
 * @returns The defines for `Bun.build`.
 * @example
 * ```ts
 * definesOf(undefined).__MOKU_GAME_AGENT__; // "false"
 * ```
 */
export function definesOf(page: DebugPage | undefined): Record<string, string> {
  if (page === undefined) {
    return {
      __MOKU_GAME_DEV__: "false",
      __MOKU_GAME_AGENT__: "false",
      __MOKU_GAME_CONTROL__: "false"
    };
  }

  return {
    __MOKU_GAME_DEV__: "false",
    __MOKU_GAME_AGENT__: "true",
    __MOKU_GAME_CONTROL__: page.level === "full" ? "true" : "false",
    __MOKU_GAME_BUILD__: JSON.stringify(page.build),
    __MOKU_GAME_ENGINE__: JSON.stringify(page.engine),
    __MOKU_GAME_EDITOR__: JSON.stringify(page.editor)
  };
}

/**
 * The in-memory files of the page under `<game>/.moku/build/`: a release page has `index.html`,
 * `main.ts` and `script.ts`; a debug page also `agent.ts`, its `main.ts` from `debugMain` with the
 * game's `.dev` modules, and its title marked `Debug`.
 *
 * @param run - The flags of the run.
 * @param settings - The resolved config.
 * @param page - What a debug page is built with; `undefined` for a release page.
 * @returns The texts by absolute path.
 */
function pageFiles(
  run: BuildRun,
  settings: ResolvedGameConfig,
  page: DebugPage | undefined
): Record<string, string> {
  const folder = path.join(run.root, ".moku", "build");
  const links = { toRoot: TO_ROOT, script: "./main.ts" };
  const release = {
    [path.join(folder, "index.html")]: pageHtml(settings.page, links),
    [path.join(folder, "main.ts")]: buildMain(settings),
    [path.join(folder, "script.ts")]: scriptMark()
  };

  if (page === undefined) return release;

  const flags = { build: page.build, control: page.level === "full", engine: page.engine };

  return {
    ...release,
    // The tab and a home-screen bookmark read "<title> Debug".
    [path.join(folder, "index.html")]: pageHtml(
      { ...settings.page, title: `${settings.page.title} Debug` },
      links
    ),
    [path.join(folder, "main.ts")]: debugMain(settings, devModulesOf(run.root)),
    [path.join(folder, "agent.ts")]: agentFlag({ ...flags, editor: page.editor })
  };
}

/**
 * Bundles the page into the output folder: its files in memory, every link `./`, the flags
 * defined, no hot plugin.
 *
 * @param run - The flags of the run.
 * @param settings - The resolved config.
 * @param page - What a debug page is built with; `undefined` for a release page.
 * @returns Resolves when the page is written.
 * @throws {Error} With one Bun log per line when the page did not bundle.
 */
async function bundlePage(
  run: BuildRun,
  settings: ResolvedGameConfig,
  page: DebugPage | undefined
): Promise<void> {
  const result = await Bun.build({
    entrypoints: [path.join(run.root, ".moku", "build", "index.html")],
    files: pageFiles(run, settings, page),
    outdir: run.out,
    publicPath: "./",
    minify: true,
    target: "browser",
    define: definesOf(page),
    naming: {
      entry: "[name].[ext]",
      chunk: "page/[name]-[hash].[ext]",
      asset: "page/[name]-[hash].[ext]"
    },
    plugins: await loadPlugins(run.servePlugins),
    throw: false
  });

  if (!result.success) {
    throw new Error(
      ["[game] build: the page did not bundle.", ...result.logs.map(String)].join("\n")
    );
  }
}

/**
 * The fallback for icons Bun left as links into the game: copies each icon beside the page and
 * links it as `./<name>`.
 *
 * @param run - The flags of the run.
 * @param settings - The resolved config.
 */
function relinkIcons(run: BuildRun, settings: ResolvedGameConfig): void {
  const file = path.join(run.out, "index.html");
  let html = readFileSync(file, "utf8");

  // Bun rewrote every link it bundled: a page with no link into the game stays as built.
  if (!html.includes(`"${TO_ROOT}`)) return;

  for (const icon of Object.values(settings.page.icons)) {
    const linked = icon?.replaceAll("\\", "/");
    const leftInGame = linked !== undefined && html.includes(`"${TO_ROOT}${linked}"`);

    if (!leftInGame) continue;

    const name = path.basename(linked);

    copyFileSync(path.join(run.root, linked), path.join(run.out, name));
    html = html.replaceAll(`"${TO_ROOT}${linked}"`, `"./${name}"`);
  }

  writeFileSync(file, html);
}

/**
 * Lists the files under a folder.
 *
 * @param folder - The folder.
 * @param relative - The folder under it to list, `/` separated.
 * @returns The files, relative to `folder`, `/` separated; none when it is missing.
 */
function filesUnder(folder: string, relative = ""): string[] {
  const here = path.join(folder, relative);

  if (statSync(here, { throwIfNoEntry: false })?.isDirectory() !== true) return [];

  return readdirSync(here, { withFileTypes: true }).flatMap(entry => {
    const inner = relative === "" ? entry.name : `${relative}/${entry.name}`;

    return entry.isDirectory() ? filesUnder(folder, inner) : [inner];
  });
}

/**
 * Refuses a release page that carries the editor's agent: reads every `.js` file of the output
 * for the two marker strings of the agent bundle. On a hit the output folder is removed, so no
 * release page with an agent is left on disk.
 *
 * @param out - The output folder.
 * @throws {Error} Naming the marker and the file, when a page file carries one.
 */
function refuseAgent(out: string): void {
  for (const file of filesUnder(out)
    .filter(name => name.endsWith(".js"))
    .toSorted()) {
    const code = readFileSync(path.join(out, file), "utf8");
    const marker = AGENT_MARKERS.find(text => code.includes(text));

    if (marker === undefined) continue;

    rmSync(out, { recursive: true, force: true });

    throw new Error(
      `[game] build: the release page carries the editor agent ("${marker}" in ${file}).\n  Import @moku-labs/editor only behind __MOKU_GAME_DEV__, or build a debug page with --debug.`
    );
  }
}

/**
 * Copies the packed assets beside the page, `manifest.json` next to `index.html`. File by file:
 * the output folder and its page folders exist already, and a packed file never replaces a page
 * file.
 *
 * @param run - The flags of the run.
 * @throws {Error} When a packed file has the path of a page file.
 */
function copyPack(run: BuildRun): void {
  const pack = path.join(run.root, "dist", "assets");
  const page = new Set(filesUnder(run.out));
  const packed = filesUnder(pack);
  const clash = packed.find(file => page.has(file));

  if (clash !== undefined) {
    throw new Error(`[game] build: "${clash}" is both a page file and a packed asset.`);
  }

  for (const file of packed) {
    const target = path.join(run.out, file);

    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(path.join(pack, file), target, constants.COPYFILE_EXCL);
  }
}

/**
 * Runs a step with a folder as the working directory, then returns to the one before.
 *
 * @param folder - The folder the step runs in.
 * @param step - The step.
 * @returns What the step resolves to.
 */
async function inFolder<Result>(folder: string, step: () => Promise<Result>): Promise<Result> {
  const before = process.cwd();

  process.chdir(folder);

  try {
    return await step();
  } finally {
    process.chdir(before);
  }
}

/**
 * Refuses `--debug` when Tauri runs the web build of a store app: `MOKU_NATIVE_PROFILE=store`.
 *
 * @param run - The flags of the run.
 * @param env - The environment the bin started with.
 * @throws {Error} When the profile is `store` and the run is a debug run.
 */
function refuseStoreDebug(run: BuildRun, env: CliDeps["env"]): void {
  if (run.debug === undefined || env.MOKU_NATIVE_PROFILE !== "store") return;

  throw new Error(
    "[game] build: MOKU_NATIVE_PROFILE is store: a store page must not carry the editor agent.\n  Build the store app without --debug."
  );
}

/**
 * What a debug run builds its page with: the editor's page agent must resolve from the game, and
 * the engine the page bundles is fingerprinted.
 *
 * @param run - The flags of a debug run.
 * @param level - Its profile.
 * @param deps - The resolver and the clock.
 * @returns The debug page and the engine fingerprint.
 * @throws {Error} With the install line when the game cannot resolve `@moku-labs/editor`, and
 *   when it cannot resolve `@moku-labs/game/hot`.
 */
function debugPageOf(
  run: BuildRun,
  level: DebugLevel,
  deps: CliDeps
): { page: DebugPage; engine: EngineFingerprint } {
  try {
    deps.resolve(DEBUG_AGENT, run.root);
  } catch (error) {
    throw new Error(
      "[game] build --debug needs @moku-labs/editor in the game.\n  Install it: bun add -d @moku-labs/editor.",
      { cause: error }
    );
  }

  const engine = engineFingerprint(run.root, hotPluginOf(run.root, deps.resolve));
  const page: DebugPage = {
    level,
    build: buildIdOf(level, deps.now()),
    engine: engine.id,
    editor: run.editor ?? DEFAULT_EDITOR
  };

  return { page, engine };
}

/**
 * The warning a debug build prints before its size line: the profile, the build id, the engine and
 * the editor address.
 *
 * @param run - The flags of the run.
 * @param debug - The debug page and the engine fingerprint.
 * @param debug.page - What the page was built with.
 * @param debug.engine - The engine it bundles.
 * @returns The line.
 */
function debugWarning(
  run: BuildRun,
  debug: { page: DebugPage; engine: EngineFingerprint }
): string {
  const { page, engine } = debug;
  const control =
    page.level === "full"
      ? "every command, the state-changing ones too"
      : "read and cosmetic commands";
  const engineText = engineLine(engine, run.root).slice("engine ".length);

  return `build: a DEBUG page with the editor agent, control: ${control}. Build ${page.build}, engine ${engineText}, editor ${page.editor}. Never ship it to a store.`;
}

/**
 * Builds the page of a game: packs the assets, replaces the output folder with the bundled page,
 * refuses a release page that carries the editor's agent, and copies the pack beside it. A debug
 * run first checks that the game resolves the editor's agent and fingerprints the engine, and
 * prints one warning before the size line.
 *
 * @param run - The flags of the run.
 * @param deps - The process seams: the asset scanner, the resolver, the clock, the environment and
 *   the console.
 * @returns The exit code: the pack's when it failed, else `0`.
 * @throws {Error} When the game, the output folder, the profile or the bundle is refused, a debug
 *   run cannot resolve the editor, or a release page carries the editor's agent.
 */
export async function runBuild(run: BuildRun, deps: CliDeps): Promise<number> {
  refuseStoreDebug(run, deps.env);

  const settings = await loadGame(run.root);

  refuseOut(run.root, run.out);

  // A debug run resolves the agent before anything is written.
  const debug = run.debug === undefined ? undefined : debugPageOf(run, run.debug, deps);
  const packed = await deps.assets(packArguments(run.root, settings, false));

  if (packed !== 0) return packed;

  rmSync(run.out, { recursive: true, force: true });

  // The page bundles in the game folder, as the dev child serves from it: a `--serve-plugin` such
  // as the tree recipe resolves the game's packages from the working directory.
  await inFolder(run.root, () => bundlePage(run, settings, debug?.page));
  relinkIcons(run, settings);

  if (debug === undefined) refuseAgent(run.out);

  copyPack(run);

  const files = filesUnder(run.out);
  const bytes = files
    .map(file => statSync(path.join(run.out, file)).size)
    .reduce((sum, size) => sum + size, 0);

  if (debug !== undefined) deps.ui.warn(debugWarning(run, debug));

  deps.ui.info(
    `built "${run.out}": ${files.length} files, ${Math.round(bytes / BYTES_PER_KB)} KB.`
  );

  return 0;
}
