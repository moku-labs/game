// Spike P4. Serves the page and saves the screenshot strips and the browser metrics the page posts.
import index from "./index.html";

const server = Bun.serve({
  port: 3054,
  development: true,
  routes: {
    "/": index,
    "/shot/:name": {
      POST: async request => {
        const name = request.params.name.replace(/[^a-z0-9-]/gi, "");
        await Bun.write(`${import.meta.dir}/shots/${name}.png`, await request.arrayBuffer());
        return new Response("saved");
      }
    },
    "/metrics/:name": {
      POST: async request => {
        const name = request.params.name.replace(/[^a-z0-9-]/gi, "");
        await Bun.write(`${import.meta.dir}/metrics-browser-${name}.json`, await request.text());
        return new Response("saved");
      }
    }
  }
});
console.log(`p4 on ${server.url}`);
