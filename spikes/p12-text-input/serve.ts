// Spike P12. Serves the page on every interface (the iOS Simulator reaches it through the host IP)
// and saves the screenshots and logs the page or the driver posts.
import index from "./index.html";
import resize from "./resize.html";

const server = Bun.serve({
  port: 3062,
  hostname: "0.0.0.0",
  development: true,
  routes: {
    "/": index,
    "/resize": resize,
    "/log/:name": {
      POST: async request => {
        const name = request.params.name.replace(/[^a-z0-9-]/gi, "");
        await Bun.write(`${import.meta.dir}/logs/${name}.json`, await request.text());
        return new Response("saved");
      }
    }
  }
});
console.log(`p12 on ${server.url}`);
