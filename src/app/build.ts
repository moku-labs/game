/**
 * @file `moku-game build`: the assets packed with the config's layers, then the production page
 * bundled by `Bun.build` in the game folder, with its HTML, `main.ts` and `script.ts` in memory
 * under a virtual `<game>/.moku/build/` that is never written, then the packed assets copied
 * beside the page. A release page that carries the editor's agent is refused and removed. With
 * `--debug` the page is a debug page instead: the editor's page agent, the game's `.dev` modules,
 * the agent and control flags, a marked title, a build id and the app id. The output works from any
 * http sub-path and from the Tauri protocol: every link starts with `./`, and the page reads
 * `manifest.json` next to itself. Under `MOKU_NATIVE_PROFILE=dev`, a test app's web build, the page
 * must be a debug page, with control and no link to the editor. Node and Bun only: the bin bundles it.
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
import {
  type EngineFingerprint,
  engineFingerprint,
  engineLine,
  packageVersionAbove
} from "./engine";
import {
  agentFlag,
  buildMain,
  DEBUG_AGENT,
  debugMain,
  linkedFiles,
  pageHtml,
  scriptMark
} from "./generate";
import { DEV_MANIFEST, devModulesOf, hotPluginOf, loadGame } from "./serve";
import type { ResolvedGameConfig } from "./types";

/**
 * The control profile of a debug page: `full` runs every command, the state-changing ones too;
 * `read` only the read and cosmetic ones. `--debug` is `full` (`--debug=full` is an alias that
 * says so); `--debug=read` is the rare read-only build.
 *
 * @example
 * ```ts
 * // moku-game build --debug
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
  /** Absent: a release page. `full` or `read`: a debug page with the editor agent and that control profile. */
  debug?: DebugLevel;
  /** The `host:port` of `--editor`; debug only. Left out, the page agent dials `DEFAULT_EDITOR`. */
  editor?: string;
};

/**
 * What a debug page is built with: its profile, its build id, the engine id, the editor address
 * and the app id (`undefined` for a game with no native identifier).
 */
type DebugPage = {
  level: DebugLevel;
  build: string;
  engine: string;
  editor: string;
  app: string | undefined;
};

/** The address the page agent of a debug page dials without `--editor`. */
const DEFAULT_EDITOR = "127.0.0.1:47600";

/**
 * What a test app's page holds in place of an address: the editor's agent opens no socket and the
 * overlay works alone. A contract with the editor, see `__MOKU_GAME_EDITOR__`.
 */
const EDITOR_OFF = "off";

/** `MOKU_NATIVE_PROFILE` of a test app's web build. */
const TEST_APP_PROFILE = "dev";

/** The package of the editor. */
const EDITOR_PACKAGE = "@moku-labs/editor";

/** The first editor that reads `EDITOR_OFF`: any before it takes the word for an address. */
const EDITOR_READS_OFF = "0.10.19";

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
 * The id of a debug build: the UTC time of the run, `YYYYMMDDTHHMMSSZ`, the same for both
 * profiles (the editor tells them apart by the CONTROL flag).
 *
 * @param now - The wall-clock time of the run, ms.
 * @returns The id.
 * @example
 * ```ts
 * buildIdOf(Date.UTC(2026, 9, 14, 15, 30, 12)); // "debug-20261014T153012Z"
 * ```
 */
export function buildIdOf(now: number): string {
  return `debug-${new Date(now).toISOString().slice(0, 19).replaceAll(/[-:]/g, "")}Z`;
}

/**
 * The app id a debug page carries, so the editor pairs a device stream with its project: the
 * native bundle identifier, with `.debug` when native builds its debug app
 * (`MOKU_NATIVE_PROFILE=debug`), which installs under that id, and `native.dev.identifier` for a
 * test app (`MOKU_NATIVE_PROFILE=dev`).
 *
 * @param native - `native` of `config.ts`, `undefined` without a native section.
 * @param profile - `MOKU_NATIVE_PROFILE` of the run.
 * @returns The app id, or `undefined` without a native section.
 * @example
 * ```ts
 * appIdOf({ name: "Timber", identifier: "com.mokulabs.timber" }, "debug"); // "com.mokulabs.timber.debug"
 * ```
 */
export function appIdOf(
  native: ResolvedGameConfig["native"],
  profile: string | undefined
): string | undefined {
  if (native === undefined) return undefined;
  if (profile === "debug") return `${native.identifier}.debug`;

  return profile === TEST_APP_PROFILE
    ? (native.dev?.identifier ?? native.identifier)
    : native.identifier;
}

/**
 * Tells whether an editor reads `"off"` in `__MOKU_GAME_EDITOR__` and opens no socket.
 *
 * @param version - The version of the installed editor, unchecked.
 * @returns True for `0.10.19` and any later `x.y.z`; false for anything older or unreadable.
 * @example
 * ```ts
 * editorReadsOff("0.9.30"); // false
 * ```
 */
export function editorReadsOff(version: string | undefined): boolean {
  const parts = /^(\d+)\.(\d+)\.(\d+)$/.exec(version ?? "")?.slice(1);

  if (parts === undefined) return false;

  const lowest = EDITOR_READS_OFF.split(".");
  const firstDifference = parts
    .map((part, index) => Number(part) - Number(lowest[index]))
    .find(difference => difference !== 0);

  return firstDifference === undefined || firstDifference > 0;
}

/**
 * The `define` map of a page: a release page defines the three flags `false`; a debug page the
 * dev flag `false`, the agent flag `true`, the control flag of its profile, and the build id, the
 * engine id, the editor address and, when the game has one, the app id (`__MOKU_GAME_APP__`) as
 * strings.
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
    __MOKU_GAME_EDITOR__: JSON.stringify(page.editor),
    ...(page.app === undefined ? {} : { __MOKU_GAME_APP__: JSON.stringify(page.app) })
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

  const flags = {
    build: page.build,
    control: page.level === "full",
    engine: page.engine,
    app: page.app
  };

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
 * Refuses the boot picture when its copy would share one name beside the page with another file left in the game. One
 * file linked twice (the favicon also the boot picture) is one copy, not a clash. Two icons of one name build as
 * before: the boot picture is the only new file the copy can lose.
 *
 * @param left - The field and the `/` path of each file Bun left as a link, in page order.
 * @throws {Error} When the boot picture and another file have one base name.
 */
function refuseNameClash(left: readonly (readonly [field: string, linked: string])[]): void {
  const byName = new Map<string, readonly [field: string, linked: string]>();

  for (const entry of left) {
    const [field, linked] = entry;
    const name = path.basename(linked);
    const earlier = byName.get(name);

    const involvesBoot = field === "page.boot.image" || earlier?.[0] === "page.boot.image";

    if (earlier !== undefined && earlier[1] !== linked && involvesBoot) {
      throw new Error(
        `[game] build: ${field} and ${earlier[0]} share the name "${name}" beside the page.`
      );
    }

    byName.set(name, entry);
  }
}

/**
 * The fallback for page files Bun left as links into the game, the icons and the boot picture:
 * copies each beside the page and links it as `./<name>`. Two such files with one name are
 * refused before anything is copied when one is the boot picture; a file Bun already linked is never copied, so it cannot
 * clash.
 *
 * @param run - The flags of the run.
 * @param settings - The resolved config.
 * @throws {Error} When two files left in the game share a name beside the page.
 */
function relinkIcons(run: BuildRun, settings: ResolvedGameConfig): void {
  const file = path.join(run.out, "index.html");
  let html = readFileSync(file, "utf8");

  // Bun rewrote every link it bundled: a page with no link into the game stays as built.
  if (!html.includes(`"${TO_ROOT}`)) return;

  const left = linkedFiles(settings.page)
    .map(([field, linkedFile]) => [field, linkedFile.replaceAll("\\", "/")] as const)
    .filter(([, linked]) => html.includes(`"${TO_ROOT}${linked}"`));

  refuseNameClash(left);

  for (const [, linked] of left) {
    // One file linked twice is copied once: its first pass relinked every occurrence.
    if (!html.includes(`"${TO_ROOT}${linked}"`)) continue;

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
 * Refuses a release page when Tauri runs the web build of a test app: `MOKU_NATIVE_PROFILE=dev`.
 * Native lets the agent through that profile, so its own check would not stop a page with no
 * overlay.
 *
 * @param run - The flags of the run.
 * @param env - The environment the bin started with.
 * @throws {Error} When the profile is `dev` and the run is a release run.
 */
function refuseTestAppRelease(run: BuildRun, env: CliDeps["env"]): void {
  if (run.debug !== undefined || env.MOKU_NATIVE_PROFILE !== TEST_APP_PROFILE) return;

  throw new Error("[game] build: MOKU_NATIVE_PROFILE is dev: a dev page carries the overlay.");
}

/**
 * Refuses the flags that have no place on a test app's page: its agent dials nothing, and a tester
 * runs every command.
 *
 * @param run - The flags of the run.
 * @param level - The profile of the run.
 * @throws {Error} When `--editor` or `--debug=read` was given.
 */
function refuseTestAppFlags(run: BuildRun, level: DebugLevel): void {
  if (run.editor !== undefined) {
    throw new Error(
      "[game] build: MOKU_NATIVE_PROFILE is dev: a dev page has no editor link.\n  Build it without --editor."
    );
  }

  if (level === "read") {
    throw new Error(
      "[game] build: MOKU_NATIVE_PROFILE is dev: a dev page runs every command.\n  Build it with --debug."
    );
  }
}

/**
 * Refuses an editor that does not read `"off"`: its agent would take the word for an address and
 * dial for ever on a tester's phone. A version that cannot be read is refused too.
 *
 * @param agent - The file the editor's page agent resolves to.
 * @throws {Error} Naming the version found.
 */
function refuseOldEditor(agent: string): void {
  const version = packageVersionAbove(agent, EDITOR_PACKAGE);

  if (editorReadsOff(version)) return;

  throw new Error(
    `[game] build: a dev page needs ${EDITOR_PACKAGE} ${EDITOR_READS_OFF} or newer, found ${version ?? "no readable version"}.\n  An older one dials the editor for ever. Run: bun add -d ${EDITOR_PACKAGE}@latest.`
  );
}

/**
 * Finds the editor's page agent the game resolves.
 *
 * @param root - The game folder.
 * @param resolve - Bun's resolver.
 * @returns The file.
 * @throws {Error} With the install line when the game cannot resolve `@moku-labs/editor`.
 */
function resolveAgent(root: string, resolve: CliDeps["resolve"]): string {
  try {
    return resolve(DEBUG_AGENT, root);
  } catch (error) {
    throw new Error(
      "[game] build --debug needs @moku-labs/editor in the game.\n  Install it: bun add -d @moku-labs/editor.",
      { cause: error }
    );
  }
}

/**
 * What a debug run builds its page with: the editor's page agent must resolve from the game, the
 * engine the page bundles is fingerprinted, and the app id comes from the native identifier. A test
 * app's page (`MOKU_NATIVE_PROFILE=dev`) holds `EDITOR_OFF` for an address, over an editor that
 * reads it.
 *
 * @param run - The flags of a debug run.
 * @param level - Its profile.
 * @param settings - The resolved config, for the native identifier.
 * @param deps - The resolver, the clock and the environment.
 * @returns The debug page and the engine fingerprint.
 * @throws {Error} With the install line when the game cannot resolve `@moku-labs/editor`, when it
 *   cannot resolve `@moku-labs/game/hot`, and under the dev profile for `--editor`, `--debug=read`
 *   and an editor that does not read `"off"`.
 */
function debugPageOf(
  run: BuildRun,
  level: DebugLevel,
  settings: ResolvedGameConfig,
  deps: CliDeps
): { page: DebugPage; engine: EngineFingerprint } {
  const profile = deps.env.MOKU_NATIVE_PROFILE;
  const isTestApp = profile === TEST_APP_PROFILE;

  if (isTestApp) refuseTestAppFlags(run, level);

  // The agent the page bundles: a test app's must read `"off"`.
  const agent = resolveAgent(run.root, deps.resolve);

  if (isTestApp) refuseOldEditor(agent);

  const engine = engineFingerprint(run.root, hotPluginOf(run.root, deps.resolve));
  const page: DebugPage = {
    level,
    build: buildIdOf(deps.now()),
    engine: engine.id,
    editor: isTestApp ? EDITOR_OFF : (run.editor ?? DEFAULT_EDITOR),
    app: appIdOf(settings.native, profile)
  };

  return { page, engine };
}

/**
 * The warning a debug build prints before its size line: the profile, the build id, the engine and
 * the editor address, and what the page is for: never a store, or a test app's track.
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
  const use =
    page.editor === EDITOR_OFF
      ? "This is a DEV page for the store test track: overlay, no editor link."
      : "Never ship it to a store.";

  return `build: a DEBUG page with the editor agent, control: ${control}. Build ${page.build}, engine ${engineText}, editor ${page.editor}. ${use}`;
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
  refuseTestAppRelease(run, deps.env);

  const settings = await loadGame(run.root);

  refuseOut(run.root, run.out);

  // A debug run resolves the agent before anything is written.
  const debug = run.debug === undefined ? undefined : debugPageOf(run, run.debug, settings, deps);
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
