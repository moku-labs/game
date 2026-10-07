/**
 * @file `moku-game visual`: the visual tests of a game from the bin. It imports the tests module,
 * `tests/visual/index.ts` by default, whose default export is `{ app, tests }`, the two arguments
 * of `runVisualTests`: `app` is a `VisualSetup`. The flags of the runner are read by
 * `parseVisualArgv`. When the pixel leg runs without `--url`, the command writes its own dev page
 * into `.moku/visual/`, so the page of `dev` or of the editor stays as it is, and serves it in this
 * process with the server of `moku-game dev` on a free port, and stops it after. Node and Bun
 * only: the bin bundles it.
 */
import { statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { VisualSetup, VisualTest } from "../visual";
import type { CliDeps } from "./cli";
import { loadGame, type PageServer, serveOn, writePage } from "./serve";

/** One `moku-game visual` run, its own flags read and its paths absolute. */
export type VisualCommand = {
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

/** What a tests module gives the runner: its setup and its tests. */
type Suite = { setup: VisualSetup; tests: readonly VisualTest[] };

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
 * Writes the visual page of the game into `.moku/visual/` and serves it in this process on a free
 * port, as `moku-game dev` serves its page.
 *
 * @param command - The run.
 * @param deps - Bun's resolver and the page loader.
 * @returns The running server.
 * @throws {Error} The errors of `moku-game dev` before its server starts.
 */
export async function serveVisualPage(
  command: VisualCommand,
  deps: Pick<CliDeps, "resolve" | "loadPage">
): Promise<PageServer> {
  const settings = await loadGame(command.root);
  const page = writePage(
    command.root,
    settings,
    { preload: command.preload, servePlugins: command.servePlugins },
    deps.resolve,
    VISUAL_PAGE
  );
  const loaded = await deps.loadPage(page.html);

  return serveOn(
    {
      root: command.root,
      port: 0,
      packed: false,
      preload: command.preload,
      servePlugins: command.servePlugins
    },
    loaded.default
  );
}

/**
 * Runs `moku-game visual`: the headless leg, then the pixel leg on a Mac (or with `--pixels`)
 * against `--url` or the page served here. The baselines live in `<game>/tests/visual/baselines/`
 * unless `--dir` names another folder.
 *
 * @param command - The run.
 * @param deps - The process seams.
 * @returns `0` when the report is ok, `1` otherwise.
 * @throws {Error} When the tests module is refused, a flag misses its value, the page cannot be
 *   served, or the runner throws.
 */
export async function runVisual(command: VisualCommand, deps: CliDeps): Promise<number> {
  const visual = await deps.visual();
  const flags = visual.parseVisualArgv(command.flags);
  const suite = await loadSuite(command.tests, deps.cwd);
  const pixels = flags.pixels ?? process.platform === "darwin";
  const dir = path.resolve(deps.cwd, flags.dir ?? path.join(command.root, BASELINES));
  // The page is served here only when the pixel leg runs and nobody serves it already.
  const server =
    pixels && command.url === undefined ? await serveVisualPage(command, deps) : undefined;
  const url = command.url ?? server?.url.href;

  try {
    const setup: VisualSetup =
      url === undefined ? suite.setup : { ...suite.setup, page: { ...suite.setup.page, url } };
    const report = await visual.runVisualTests(setup, suite.tests, {
      ...flags,
      pixels,
      dir,
      argv: []
    });

    return report.ok ? 0 : 1;
  } finally {
    await server?.stop(true);
  }
}
