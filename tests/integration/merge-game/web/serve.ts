/**
 * @file The dev server of the fixture page: the bundled page on `/`, and the committed manifest and
 * tiles as static files. Bun's `bun ./index.html` serves the page only, so the assets need this
 * one route. Run from `tests/integration/merge-game/`: `bun ./web/serve.ts`.
 */
import { file } from "bun";
import index from "./index.html";

const root = new URL("..", import.meta.url).pathname;

const server = Bun.serve({
  port: 3000,
  development: true,
  routes: { "/": index },
  fetch(request) {
    const path = new URL(request.url).pathname;
    const asset = file(`${root}${path.slice(1)}`);

    return asset.size > 0 ? new Response(asset) : new Response("not found", { status: 404 });
  }
});

console.log(`merge-game on ${server.url}`);
