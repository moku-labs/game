/**
 * @file The static build of the fixture page, the web build of the native app in `../native.ts`:
 * the page bundled with Bun into `dist/web/`, and the packed assets of `bun run fixture:pack`
 * copied beside it, so the page finds `/manifest.json` at its root as `serve.ts --packed` serves
 * it. Run from the root of the repository, after the pack:
 *
 * - `bun tests/integration/merge-game/web/build.ts` bundles `web/index.html`.
 * - `--page <html>` bundles another page instead, one that loads `web/main.ts` beside its own
 *   scripts, as the e2e station does with its probe.
 */
import { cpSync, existsSync, rmSync } from "node:fs";
import path from "node:path";
import { createBrandConsole } from "@moku-labs/common/cli";

/** The folder of the fixture game. */
const gameFolder = new URL("..", import.meta.url).pathname;

/** Where `bun run fixture:pack` writes the packed build. */
const packFolder = path.join(gameFolder, "dist/assets");

/** Where the static page goes: the `web.dist` of the native app. */
const outFolder = path.join(gameFolder, "dist/web");

/**
 * Reads the page to bundle from the command line: the file after `--page`, or the fixture page.
 *
 * @param argv - The arguments after the script.
 * @returns The absolute path of the page.
 */
function pageOf(argv: readonly string[]): string {
  const at = argv.indexOf("--page");
  const given = at === -1 ? undefined : argv[at + 1];

  return given === undefined ? path.join(gameFolder, "web/index.html") : path.resolve(given);
}

const ui = createBrandConsole();

if (existsSync(path.join(packFolder, "manifest.json"))) {
  rmSync(outFolder, { recursive: true, force: true });

  const page = pageOf(process.argv.slice(2));
  const result = await Bun.build({ entrypoints: [page], outdir: outFolder, minify: true });

  if (result.success) {
    cpSync(packFolder, outFolder, { recursive: true });
    ui.info(`merge-game page ${path.relative(process.cwd(), page)} built into ${outFolder}`);
  } else {
    ui.error(`the page did not bundle:\n${result.logs.map(String).join("\n")}`);
    process.exitCode = 1;
  }
} else {
  ui.error(
    `no packed build in "${packFolder}".\n` +
      'Run "bun run fixture:pack" from the root of the repository first.'
  );
  process.exitCode = 1;
}
