/**
 * @file The visual tests of the mini game on the command line: the headless leg, then the pixel
 * leg in Chrome with WebGPU against the dev page. The engine's runner decides the pixel leg: it
 * runs on a Mac only. When it runs, this script serves the dev page itself with
 * `moku-game dev --port 0` through the test bin, reads the URL line and stops the server at the
 * end. The runner comes from `src/`, not from the package name, so a stale `dist/` never writes
 * baselines:
 *
 * - `bun run mini:visual` compares with the baselines.
 * - `--url <url>` uses a page that is already served, such as `bun run mini:dev`, instead of
 *   starting one.
 * - `--update` rewrites the baselines, `--only <name>` runs one test, `--no-pixels` the headless
 *   leg only. The engine commits the headless baselines only: `--no-pixels --update`.
 *
 * The exit code is 1 when a checkpoint differs or a test fails.
 */
import { parseVisualArgv, runVisualTests } from "../../src/visual";
import type { StartedBin } from "../integration/app-helpers";
import { MINI_GAME, startBin, urlOf } from "../integration/app-helpers";
import { miniApp } from "./fixture";
import { miniVisualTests } from "./tests";

/** A dev server this script started, and the URL it printed. */
type Served = { started: StartedBin; url: string };

/**
 * Reads the URL after `--url`.
 *
 * @param argv - The arguments after the script.
 * @returns The URL, or `undefined` when none is given.
 */
function givenUrl(argv: readonly string[]): string | undefined {
  const at = argv.indexOf("--url");

  return at === -1 ? undefined : argv[at + 1];
}

/**
 * Starts `moku-game dev` on the mini game on a free port and waits for its URL line.
 *
 * @returns The server and its URL, ending in `/`.
 */
async function serve(): Promise<Served> {
  const started = startBin(["dev", "--root", MINI_GAME, "--port", "0"]);

  return { started, url: await urlOf(started) };
}

/**
 * Stops the server the way Ctrl+C does, so the parent hands the signal to its child, and waits.
 *
 * @param served - The server, when this script started one.
 */
async function stop(served: Served | undefined): Promise<void> {
  if (served === undefined) return;

  served.started.child.kill("SIGINT");
  await served.started.exit;
}

const argv = process.argv.slice(2);
const flags = parseVisualArgv(argv);
const url = givenUrl(argv);
const pixels = flags.pixels ?? process.platform === "darwin";
const served = pixels && url === undefined ? await serve() : undefined;
const pageUrl = url ?? served?.url;

try {
  const report = await runVisualTests(
    { app: miniApp, ...(pageUrl === undefined ? {} : { page: { url: pageUrl } }) },
    miniVisualTests
  );

  process.exitCode = report.ok ? 0 : 1;
} finally {
  await stop(served);
}
