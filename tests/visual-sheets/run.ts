/**
 * @file The visual tests of the sheets game on the command line: the headless leg, then the pixel leg in Chrome on
 * WebGPU and again on WebGL (`?renderer=webgl`), against the dev page, with `debug.verifyFrames` on: a
 * `renderer:missed-frame`, a `renderer:missed-mark` or a `renderer:stale-picture` fails the step. The engine's runner
 * decides the pixel leg: it runs on a Mac only. When it runs, this script serves the dev page itself with
 * `moku-game dev --port 0` through the test bin and stops the server at the end. The runner comes from `src/`:
 *
 * - `bun run sheets:visual` compares with the baselines, on both backends.
 * - `--url <url>` uses a page that is already served instead of starting one.
 * - `--update` rewrites the baselines, `--only <name>` runs one test, `--no-pixels` the headless leg only. The
 *   engine commits the headless baselines only: `--no-pixels --update`.
 *
 * The exit code is 1 when a checkpoint differs or a test fails on either backend.
 */
import { fileURLToPath } from "node:url";
import { parseVisualArgv, runVisualTests } from "../../src/visual";
import type { StartedBin } from "../integration/app-helpers";
import { SHEETS_GAME, startBin, urlOf } from "../integration/app-helpers";
import { sheetsApp } from "./fixture";
import { sheetsVisualTests } from "./tests";

/** A dev server this script started, and the URL it printed. */
type Served = { started: StartedBin; url: string };

/** The folder of the suite and its baselines. */
const dir = fileURLToPath(new URL("./", import.meta.url));

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
 * Starts `moku-game dev` on the sheets game on a free port and waits for its URL line.
 *
 * @returns The server and its URL, ending in `/`.
 */
async function serve(): Promise<Served> {
  const started = startBin(["dev", "--root", SHEETS_GAME, "--port", "0"]);

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
const setup = { app: sheetsApp, ...(pageUrl === undefined ? {} : { page: { url: pageUrl } }) };

try {
  const webgpu = await runVisualTests(setup, sheetsVisualTests, { dir });
  // The WebGL leg reruns the tests that ask for it (all five) on `?renderer=webgl`; the headless leg again is cheap.
  const webgl = pixels
    ? await runVisualTests(setup, sheetsVisualTests, { dir, renderer: "webgl" })
    : webgpu;

  process.exitCode = webgpu.ok && webgl.ok ? 0 : 1;
} finally {
  await stop(served);
}
