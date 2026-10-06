/**
 * @file `moku-game build`: the assets packed with the config's layers, then the production page
 * bundled by `Bun.build` in the game folder, with its HTML and `main.ts` in memory under a virtual
 * `<game>/.moku/build/` that is never written, then the packed assets copied beside the page. The
 * output works from any http sub-path and from the Tauri protocol: every link starts with `./`,
 * and the page reads `manifest.json` next to itself. Node and Bun only: the bin bundles it.
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
import type { CliDeps } from "./cli";
import { buildMain, pageHtml } from "./generate";
import { loadGame } from "./serve";
import type { ResolvedGameConfig } from "./types";

/** One `moku-game build` run, its flags read and its paths absolute. */
export type BuildRun = {
  /** The game folder. */
  root: string;
  /** The output folder, replaced by the run. */
  out: string;
  /** Bun plugins the page bundles with. */
  servePlugins: readonly string[];
};

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
 * Lists the folders right inside a folder.
 *
 * @param folder - The folder.
 * @returns Their absolute paths; none when the folder is missing.
 */
function foldersIn(folder: string): string[] {
  if (statSync(folder, { throwIfNoEntry: false })?.isDirectory() !== true) return [];

  return readdirSync(folder, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => path.join(folder, entry.name));
}

/**
 * Tells whether a game has an English string file to derive the pseudo-locale from: a
 * `strings/en.json` in a feature folder or in a layer folder of the config.
 *
 * @param root - The game folder.
 * @param settings - The resolved config, for its layer folders.
 * @returns True when at least one such file exists.
 */
function hasEnglishStrings(root: string, settings: ResolvedGameConfig): boolean {
  // Strings live in each feature folder and in each layer folder the config names.
  const featureFolders = foldersIn(path.join(root, "features"));
  const layerFolders = Object.keys(settings.assets.layers).map(folder => path.join(root, folder));

  // One English file is enough: the pseudo-locale is derived from English.
  return [...featureFolders, ...layerFolders].some(
    folder =>
      statSync(path.join(folder, "strings", "en.json"), { throwIfNoEntry: false })?.isFile() ===
      true
  );
}

/**
 * The flags of the asset scan for `moku-game keys`: the dev manifest beside the game, the
 * pseudo-locale when the game has an English string file, and `--check` for a check run.
 *
 * @param root - The game folder.
 * @param settings - The resolved config.
 * @param check - True to check instead of write.
 * @returns The flags for the scanner's command line.
 * @example
 * ```ts
 * keysArguments("/g", resolveConfig({ page: { title: "T" } }), true).slice(4); // ["--manifest", "/g/manifest.json", "--check"]: no strings
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
    path.join(root, "manifest.json"),
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
 * Bundles the production page into the output folder: the HTML and `main.ts` in memory, every
 * link `./`, the dev flag defined false, no hot plugin.
 *
 * @param run - The flags of the run.
 * @param settings - The resolved config.
 * @returns Resolves when the page is written.
 * @throws {Error} With one Bun log per line when the page did not bundle.
 */
async function bundlePage(run: BuildRun, settings: ResolvedGameConfig): Promise<void> {
  const folder = path.join(run.root, ".moku", "build");
  const html = path.join(folder, "index.html");
  const main = path.join(folder, "main.ts");
  const result = await Bun.build({
    entrypoints: [html],
    files: {
      [html]: pageHtml(settings.page, { toRoot: TO_ROOT, script: "./main.ts" }),
      [main]: buildMain(settings)
    },
    outdir: run.out,
    publicPath: "./",
    minify: true,
    target: "browser",
    define: { __MOKU_GAME_DEV__: "false" },
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
 * Builds the production page of a game: packs the assets, replaces the output folder with the
 * bundled page, and copies the pack beside it.
 *
 * @param run - The flags of the run.
 * @param deps - The process seams: the asset scanner and the console.
 * @returns The exit code: the pack's when it failed, else `0`.
 * @throws {Error} When the game, the output folder or the bundle is refused.
 */
export async function runBuild(run: BuildRun, deps: CliDeps): Promise<number> {
  const settings = await loadGame(run.root);

  refuseOut(run.root, run.out);

  const packed = await deps.assets(packArguments(run.root, settings, false));

  if (packed !== 0) return packed;

  rmSync(run.out, { recursive: true, force: true });

  // The page bundles in the game folder, as the dev child serves from it: a `--serve-plugin` such
  // as the tree recipe resolves the game's packages from the working directory.
  await inFolder(run.root, () => bundlePage(run, settings));
  relinkIcons(run, settings);
  copyPack(run);

  const files = filesUnder(run.out);
  const bytes = files
    .map(file => statSync(path.join(run.out, file)).size)
    .reduce((sum, size) => sum + size, 0);

  deps.ui.info(
    `built "${run.out}": ${files.length} files, ${Math.round(bytes / BYTES_PER_KB)} KB.`
  );

  return 0;
}
