/** Tiny report sink: POST /report appends one JSON line to reports.jsonl next to this folder. */
import { appendFileSync } from "node:fs";
import path from "node:path";

const log = path.join(import.meta.dir, "..", "reports.jsonl");
const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "POST, GET, OPTIONS" };

Bun.serve({
  port: Number(process.env.PORT ?? 8787),
  hostname: "127.0.0.1",
  fetch: async request => {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const body = request.method === "POST" ? await request.text() : new URL(request.url).search;
    const line = JSON.stringify({ at: new Date().toISOString(), origin: request.headers.get("origin"), body });
    appendFileSync(log, `${line}\n`);
    console.log(line);
    return new Response("ok", { headers: cors });
  }
});
console.log("report server on 127.0.0.1:" + (process.env.PORT ?? 8787));
