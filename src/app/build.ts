/**
 * @file `moku-game build`: the assets packed with the config's layers, then the production page
 * bundled by `Bun.build` with its HTML and `main.ts` in memory under a virtual
 * `<game>/.moku/build/` that is never written, then the packed assets copied beside the page. The
 * output works from any http sub-path and from the Tauri protocol: every link starts with `./`,
 * and the page reads `manifest.json` next to itself. Node and Bun only: the bin bundles it.
 */
import {
  copyFileSync,
  cpSync,
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
 * The flags of the asset scan for `moku-game keys`: the dev manifest beside the game, the
 * pseudo-locale, and `--check` for a check run.
 *
 * @param root - The game folder.
 * @param settings - The resolved config.
 * @param check - True to check instead of write.
 * @returns The flags for the scanner's command line.
 * @example
 * ```ts
 * keysArguments("/g", resolveConfig({ page: { title: "T" } }), true).slice(4); // ["--manifest", "/g/manifest.json", "--pseudo", "--check"]
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
    "--pseudo",
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
 * Tells whether a folder is another folder or holds it.
 *
 * @param folder - The outer folder.
 * @param inner - The folder that may sit inside it.
 * @returns True when `inner` is `folder` or lies under it.
 * @example
 * ```ts
 * holds("/g/dist/web", "/g"); // false
 * ```
 */
function holds(folder: string, inner: string): boolean {
  const relative = path.relative(folder, inner);

  return (
    relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

/**
 * Refuses an output folder whose removal would take the game or its packed assets with it.
 *
 * @param root - The game folder.
 * @param out - The output folder.
 * @throws {Error} When the folder is the game, holds it, or is, holds or lies in the pack.
 */
function refuseOut(root: string, out: string): void {
  const pack = path.join(root, "dist", "assets");

  if (holds(out, root) || holds(out, pack) || holds(pack, out)) {
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

  if (!html.includes(`"${TO_ROOT}`)) return;

  for (const icon of Object.values(settings.page.icons)) {
    const linked = icon?.replaceAll("\\", "/");

    if (linked === undefined || !html.includes(`"${TO_ROOT}${linked}"`)) continue;

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
 * Copies the packed assets beside the page, `manifest.json` next to `index.html`.
 *
 * @param run - The flags of the run.
 * @throws {Error} When a packed file has the path of a page file.
 */
function copyPack(run: BuildRun): void {
  const pack = path.join(run.root, "dist", "assets");
  const page = new Set(filesUnder(run.out));
  const clash = filesUnder(pack).find(file => page.has(file));

  if (clash !== undefined) {
    throw new Error(`[game] build: "${clash}" is both a page file and a packed asset.`);
  }

  cpSync(pack, run.out, { recursive: true, errorOnExist: true, force: false });
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
  await bundlePage(run, settings);
  relinkIcons(run, settings);
  copyPack(run);

  const files = filesUnder(run.out);
  const bytes = files
    .map(file => statSync(path.join(run.out, file)).size)
    .reduce((sum, size) => sum + size, 0);

  deps.ui.info(`built "${run.out}": ${files.length} files, ${Math.round(bytes / 1024)} KB.`);

  return 0;
}
