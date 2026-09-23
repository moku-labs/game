/**
 * @file The dev server of the fixture page: the bundled page on `/`, and the committed manifest and
 * tiles as static files. Bun's `bun ./index.html` serves the page only, so the assets need this
 * one route. Run from `tests/integration/merge-game/`: `bun ./web/serve.ts`.
 */
import { createBrandConsole } from "@moku-labs/common/cli";
import { file } from "bun";
import index from "./index.html";

const root = new URL("..", import.meta.url).pathname;

const server = Bun.serve({
  port: 3000,
  development: true,
  routes: { "/": index },
  fetch(request) {
    // The browser percent-encodes the braces of a nine-slice tag (`{nine=…}`), the disk does not.
    const path = decodeURIComponent(new URL(request.url).pathname);

    // A decoded path could climb out of the game folder; the page never asks for one.
    if (path.includes("..")) return new Response("not found", { status: 404 });

    const asset = file(`${root}${path.slice(1)}`);

    return asset.size > 0 ? new Response(asset) : new Response("not found", { status: 404 });
  }
});

createBrandConsole().info(`merge-game on ${server.url}`);
