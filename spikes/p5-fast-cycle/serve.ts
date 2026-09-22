// Spike P5. Serves the page and saves the screenshot strips that the page posts.
import index from "./index.html";

const server = Bun.serve({
  port: 3055,
  development: true,
  routes: {
    "/": index,
    "/shot/:name": {
      POST: async request => {
        const name = request.params.name.replace(/[^a-z0-9-]/gi, "");
        await Bun.write(`${import.meta.dir}/shots/${name}.png`, await request.arrayBuffer());
        return new Response("saved");
      }
    }
  }
});
console.log(`p5 on ${server.url}`);
