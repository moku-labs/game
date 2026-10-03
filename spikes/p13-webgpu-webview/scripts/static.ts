/** Serves dist/ on 127.0.0.1:8790, to load the same P13 page in Safari for comparison. */
import path from "node:path";

const dist = path.join(import.meta.dir, "..", "dist");
Bun.serve({
  port: 8790,
  hostname: "127.0.0.1",
  fetch: request => {
    const name = new URL(request.url).pathname;
    return new Response(Bun.file(path.join(dist, name === "/" ? "index.html" : name)));
  }
});
