// Spike P18. `bun spikes/p18-scroll-window/serve.ts` serves the probe page on port 3118.
import index from "./index.html";

const server = Bun.serve({ port: 3118, development: true, routes: { "/": index } });
console.log(`p18 on ${server.url}`);
