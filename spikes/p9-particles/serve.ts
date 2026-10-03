// Spike P9. Serves the page. bun serve.ts, then http://localhost:3059
import index from "./index.html";

const server = Bun.serve({
  port: 3059,
  development: false,
  routes: { "/": index }
});
console.log(`p9 on ${server.url}`);
