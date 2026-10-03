/**
 * @file The visual tests of the fixture game on the command line: the headless leg, then the
 * pixel leg in Chrome with WebGPU against the dev page (Mac only). Run from the root of the
 * repository while the dev page is served (`bun tests/integration/merge-game/web/serve.ts`).
 * The runner comes from `src/`, not from the package name, so a stale `dist/` never writes
 * baselines:
 *
 * - `bun run fixture:visual` compares with the baselines; the page is http://localhost:3000/.
 * - `--url <url>` names another page, such as one served with `--port 4173`.
 * - `--update` rewrites the baselines, `--only <name>` runs one test, `--no-pixels` the headless
 *   leg only.
 * - `--webgl` runs the tests with `webgl: true` on the page with `?renderer=webgl`, against their
 *   `screen.webgl.webp` baselines; `runVisualTests` reads the flag itself.
 *
 * The exit code is 1 when a checkpoint differs or a test fails.
 */
import { runVisualTests } from "../../src/testing";
import { fixtureApp } from "./fixture";
import { fixtureVisualTests } from "./tests";

/** The page `web/serve.ts` serves when no port is given. */
const DEFAULT_URL = "http://localhost:3000/";

/**
 * Reads the URL of the dev page from the command line: the value after `--url`.
 *
 * @param argv - The arguments after the script.
 * @returns The URL.
 */
function pageUrl(argv: readonly string[]): string {
  const at = argv.indexOf("--url");

  return at === -1 ? DEFAULT_URL : (argv[at + 1] ?? DEFAULT_URL);
}

const report = await runVisualTests(
  { app: fixtureApp, page: { url: pageUrl(process.argv.slice(2)) } },
  fixtureVisualTests
);

process.exitCode = report.ok ? 0 : 1;
