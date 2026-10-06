/**
 * @file The dev server of the fixture page: the bundled page on `/`, and the game's files as
 * static files. Bun's `bun ./index.html` serves the page only, so the assets need this one route.
 * Run from `tests/fixtures/mini-game/`:
 *
 * - `bun ./web/serve.ts` serves the dev build: the committed `manifest.json` and the loose art
 *   under `features/`.
 * - `bun ./web/serve.ts --packed` serves the production build instead: the v2 manifest and the
 *   hashed files that `bun run mini:pack` writes into `dist/assets/`. A folder after the flag
 *   serves another pack: `--packed <folder>`.
 * - `--port <n>` picks the port, 3000 when left out; `0` lets the system choose a free one.
 *
 * The page is the same in both builds: it fetches `/manifest.json`, and the paths of the manifest
 * are relative to it.
 */
import path from "node:path";
import { createBrandConsole } from "@moku-labs/common/cli";
import { file } from "bun";
import index from "./index.html";

/** What the command line asks for: the folder whose files are served, and the port. */
type ServeOptions = { root: string; packed: boolean; port: number };

/** The folder of the fixture game: the dev manifest and `features/` live here. */
const gameFolder = new URL("..", import.meta.url).pathname;

/** Where `bun run mini:pack` writes the packed build. */
const packFolder = path.join(gameFolder, "dist/assets");

/** The port of the dev page, which the pixel leg of the visual tests opens by default. */
const DEFAULT_PORT = 3000;

/**
 * Reads the flags of the server: `--packed [folder]` and `--port <n>`.
 *
 * @param argv - The arguments after the script.
 * @returns The folder to serve, whether it is a packed build, and the port.
 */
function optionsOf(argv: readonly string[]): ServeOptions {
  const at = argv.indexOf("--packed");
  const folder = at === -1 ? undefined : argv[at + 1];
  const given = folder === undefined || folder.startsWith("--") ? packFolder : path.resolve(folder);
  const port = argv.indexOf("--port");

  return {
    root: at === -1 ? gameFolder : given,
    packed: at !== -1,
    port: port === -1 ? DEFAULT_PORT : Number(argv[port + 1])
  };
}

/**
 * Answers one request for a file of the served folder.
 *
 * @param root - The served folder.
 * @param request - The request of the page.
 * @returns The file, or a 404.
 */
function serveFile(root: string, request: Request): Response {
  const relative = decodeURIComponent(new URL(request.url).pathname);

  // A decoded path could climb out of the served folder; the page never asks for one.
  if (relative.includes("..")) return new Response("not found", { status: 404 });

  const asset = file(path.join(root, relative));

  return asset.size > 0 ? new Response(asset) : new Response("not found", { status: 404 });
}

const options = optionsOf(process.argv.slice(2));
const ui = createBrandConsole();

if (options.packed && !(await file(path.join(options.root, "manifest.json")).exists())) {
  ui.error(
    `no packed build in "${options.root}".\n` +
      'Run "bun run mini:pack" from the root of the repository first.'
  );
  process.exitCode = 1;
} else {
  const server = Bun.serve({
    port: options.port,
    development: true,
    routes: { "/": index },
    fetch: request => serveFile(options.root, request)
  });

  ui.info(`mini-game${options.packed ? " (packed build)" : ""} on ${server.url}`);
}
