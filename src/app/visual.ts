/**
 * @file `moku-game visual`: the visual tests of a game from the bin. It imports the tests module,
 * `tests/visual/index.ts` by default, whose default export is `{ app, tests }`, the two arguments
 * of `runVisualTests`: `app` is a `VisualSetup`. The flags of the runner are read by
 * `parseVisualArgv`. When the pixel leg runs without `--url`, the command writes its own dev page
 * into `.moku/visual/`, so the page of `dev` or of the editor stays as it is, runs the bin again
 * under that page's bunfig as `dev` does, and the child serves the page with the server of `dev`
 * on a free port and stops it after. Node and Bun only: the bin bundles it.
 */
import { statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { VisualSetup, VisualTest } from "../visual";
import type { CliDeps, VisualRunner } from "./cli";
import {
  loadGame,
  type PageFiles,
  type PageServer,
  runChild,
  serveOn,
  watchParent,
  writePage
} from "./serve";

/** One `moku-game visual` run, its own flags read and its paths absolute. */
export type VisualCommand = {
  /** The arguments after the bin, for the run of the bin again. */
  argv: readonly string[];
  /** The game folder. */
  root: string;
  /** The tests module. */
  tests: string;
  /** The page of the pixel leg, when it is served already. */
  url?: string;
  /** The flags of the runner, for `parseVisualArgv`: `--update`, `--only <name>`, ... */
  flags: readonly string[];
  /** Files Bun preloads, written into the page's bunfig. */
  preload: readonly string[];
  /** Extra Bun plugins of the page, written into its bunfig. */
  servePlugins: readonly string[];
};

/** What the visual page is written from: the game folder, the preloads and the serve plugins. */
export type VisualPageRun = Pick<VisualCommand, "root" | "preload" | "servePlugins">;

/** What a tests module gives the runner: its setup and its tests. */
type Suite = { setup: VisualSetup; tests: readonly VisualTest[] };

/** How a run plays: the runner, its flags, whether the pixel leg runs and the page is served. */
type Played = {
  visual: VisualRunner;
  flags: ReturnType<VisualRunner["parseVisualArgv"]>;
  pixels: boolean;
  serves: boolean;
};

/** The baselines of a game, under the game folder. */
const BASELINES = path.join("tests", "visual", "baselines");

/** The folder of the visual page under the game: its own, beside the page of `dev`. */
const VISUAL_PAGE = ".moku/visual";

/**
 * Tells whether a value is a setup of the runner: an object with an `app` function.
 *
 * @param value - The `app` of the module.
 * @returns True for a `VisualSetup`.
 */
function isSetup(value: unknown): value is VisualSetup {
  return (
    typeof value === "object" && value !== null && "app" in value && typeof value.app === "function"
  );
}

/**
 * Reads the default export of a tests module: `app` is the setup of the runner, `{ app, page? }`,
 * and `tests` is a list. Each test is checked by the runner.
 *
 * @param value - The default export.
 * @returns The suite, or `undefined` for another shape.
 */
function suiteOf(value: unknown): Suite | undefined {
  if (typeof value !== "object" || value === null || !("app" in value) || !("tests" in value)) {
    return undefined;
  }

  const { app, tests } = value;

  return Array.isArray(tests) && isSetup(app) ? { setup: app, tests } : undefined;
}

/**
 * Imports the tests module of the run.
 *
 * @param file - The module, absolute.
 * @param cwd - The working directory, to name the module in the message.
 * @returns The setup and the tests.
 * @throws {Error} When the module is missing or its default export is not `{ app, tests }`.
 */
async function loadSuite(file: string, cwd: string): Promise<Suite> {
  const exists = statSync(file, { throwIfNoEntry: false })?.isFile() === true;
  const loaded = exists
    ? ((await import(pathToFileURL(file).href)) as { default?: unknown })
    : undefined;
  const suite = suiteOf(loaded?.default);

  if (suite === undefined) {
    throw new Error(
      `[game] visual: ${path.relative(cwd, file)} must export default { app, tests }.\n` +
        "  app is a VisualSetup { app, page? }: export default { app: { app: () => game.screen().app }, tests }."
    );
  }

  return suite;
}

/**
 * Writes the visual page of the game into `.moku/visual/`: `index.html`, `dev.ts`, `main.ts` and
 * `bunfig.toml`, the hot plugin, the serve plugins and the preloads in it, as `dev` writes its page.
 *
 * @param page - The game folder, the preloads and the serve plugins.
 * @param resolve - Bun's resolver, to find the hot plugin.
 * @returns The paths of the HTML and the bunfig.
 * @throws {Error} The errors of `moku-game dev` before its server starts, and a game without
 *   `manifest.json`.
 */
export async function writeVisualPage(
  page: VisualPageRun,
  resolve: CliDeps["resolve"]
): Promise<PageFiles> {
  const settings = await loadGame(page.root);
  const manifest = path.join(page.root, "manifest.json");

  // The page loads its assets through the dev manifest: without it the pictures are empty.
  if (statSync(manifest, { throwIfNoEntry: false })?.isFile() !== true) {
    throw new Error(
      `[game] visual: no manifest.json in "${page.root}".\n  Run "moku-game keys" first.`
    );
  }

  return writePage(
    page.root,
    settings,
    { preload: page.preload, servePlugins: page.servePlugins },
    resolve,
    VISUAL_PAGE
  );
}

/**
 * Writes the visual page and serves it in this process on a free port, as the dev child serves
 * its page. It runs in the child that runs under the page's bunfig, so the hot plugin, the serve
 * plugins and the preloads apply.
 *
 * @param page - The game folder, the preloads and the serve plugins.
 * @param deps - Bun's resolver and the page loader.
 * @returns The running server.
 * @throws {Error} The errors of `writeVisualPage`.
 */
export async function serveVisualPage(
  page: VisualPageRun,
  deps: Pick<CliDeps, "resolve" | "loadPage">
): Promise<PageServer> {
  const files = await writeVisualPage(page, deps.resolve);
  const loaded = await deps.loadPage(files.html);

  return serveOn(
    {
      root: page.root,
      port: 0,
      packed: false,
      preload: page.preload,
      servePlugins: page.servePlugins
    },
    loaded.default
  );
}

/**
 * Runs the bin again for a run that has to: under the visual page's bunfig when the page is
 * served, so it is bundled as `dev` bundles its page; with Bun's preloads otherwise.
 *
 * @param command - The run.
 * @param serves - True when the page is served for the run.
 * @param deps - The process seams.
 * @returns The exit code of the child.
 * @throws {Error} The errors of `writeVisualPage`.
 */
async function rerun(command: VisualCommand, serves: boolean, deps: CliDeps): Promise<number> {
  const page = serves ? await writeVisualPage(command, deps.resolve) : undefined;
  const bun =
    page === undefined
      ? command.preload.map(file => `--preload=${file}`)
      : [`--config=${page.bunfig}`];

  return runChild([deps.execPath, ...bun, ...deps.self, ...command.argv], deps, { cwd: deps.cwd });
}

/**
 * Plays the tests in this process: the headless leg, then the pixel leg against `--url` or the
 * page served here, which stops when the run ends or the parent of the run is gone.
 *
 * @param command - The run.
 * @param run - The runner, its flags, and whether the pixel leg runs.
 * @param deps - The process seams.
 * @returns `0` when the report is ok, `1` otherwise.
 * @throws {Error} When the tests module is refused, the page cannot be served, or the runner
 *   throws.
 */
async function play(command: VisualCommand, run: Played, deps: CliDeps): Promise<number> {
  const suite = await loadSuite(command.tests, deps.cwd);
  const dir = path.resolve(deps.cwd, run.flags.dir ?? path.join(command.root, BASELINES));
  // The page is served here only when the pixel leg runs and nobody serves it already.
  const server = run.serves ? await serveVisualPage(command, deps) : undefined;
  // A parent that is gone stops the page, so the run ends instead of playing on alone.
  const unwatch = server === undefined ? undefined : watchParent(() => server.stop(true));
  const url = command.url ?? server?.url.href;

  try {
    const setup: VisualSetup =
      url === undefined ? suite.setup : { ...suite.setup, page: { ...suite.setup.page, url } };
    const report = await run.visual.runVisualTests(setup, suite.tests, {
      ...run.flags,
      pixels: run.pixels,
      dir,
      argv: []
    });

    return report.ok ? 0 : 1;
  } finally {
    unwatch?.();
    await server?.stop(true);
  }
}

/**
 * Runs `moku-game visual`: the headless leg, then the pixel leg on a Mac (or with `--pixels`)
 * against `--url` or the page served for the run. A run that serves the page runs the bin again
 * under `.moku/visual/bunfig.toml`, as `dev` does, and a run with `--preload` with the preloads;
 * the marked child plays the tests. The baselines live in `<game>/tests/visual/baselines/` unless
 * `--dir` names another folder.
 *
 * @param command - The run.
 * @param deps - The process seams.
 * @returns `0` when the report is ok, `1` otherwise, or the exit code of the child.
 * @throws {Error} When the tests module is refused, a flag misses its value, the page cannot be
 *   served, or the runner throws.
 */
export async function runVisual(command: VisualCommand, deps: CliDeps): Promise<number> {
  const visual = await deps.visual();
  const flags = visual.parseVisualArgv(command.flags);
  const pixels = flags.pixels ?? process.platform === "darwin";
  const serves = pixels && command.url === undefined;
  const isChild = deps.env.MOKU_GAME_CHILD === "1";

  if (!isChild && (serves || command.preload.length > 0)) return rerun(command, serves, deps);

  return play(command, { visual, flags, pixels, serves }, deps);
}
