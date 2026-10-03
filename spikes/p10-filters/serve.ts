// Spike P10. Serves the page. drive.ts opens it in Chrome with WebGPU.
import index from "./index.html";

const server = Bun.serve({ port: 3060, development: false, routes: { "/": index } });
console.log(`p10 on ${server.url}`);
