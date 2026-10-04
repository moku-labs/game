// Probe server. Port 8796: the page, /range/* honours Range (206), /norange/* always answers
// 200 with the whole body and no Accept-Ranges (what P15 saw from tauri://). Port 8797: the same
// media cross-origin WITHOUT CORS headers. Every media request is logged to requests.jsonl.
import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = import.meta.dir;
const log = join(dir, "requests.jsonl");
writeFileSync(log, "");

async function media(req: Request, path: string, range: boolean, cors: boolean): Promise<Response> {
  const file = Bun.file(join(dir, "media", path));
  if (!(await file.exists())) return new Response("missing", { status: 404 });
  const size = file.size;
  const type = path.endsWith(".mp3") ? "audio/mpeg" : path.endsWith(".m4a") ? "audio/mp4"
    : path.endsWith(".webm") ? "audio/webm" : path.endsWith(".wav") ? "audio/wav" : "audio/ogg";
  const header = req.headers.get("range");
  const base: Record<string, string> = { "content-type": type, "cache-control": "no-store" };
  if (cors) base["access-control-allow-origin"] = "*";
  appendFileSync(log, JSON.stringify({ t: Date.now(), path, mode: range ? "range" : "norange", cors, range: header, ua: /HeadlessChrome|Chrome\//.test(req.headers.get("user-agent") ?? "") ? "chromium" : "webkit" }) + "\n");
  if (range) base["accept-ranges"] = "bytes";
  const m = header?.match(/bytes=(\d*)-(\d*)/);
  if (!range || !m) return new Response(file, { status: 200, headers: { ...base, "content-length": String(size) } });
  const start = m[1] === "" ? size - Number(m[2]) : Number(m[1]);
  const end = m[1] !== "" && m[2] !== "" ? Math.min(Number(m[2]), size - 1) : size - 1;
  return new Response(file.slice(start, end + 1), {
    status: 206,
    headers: { ...base, "content-range": `bytes ${start}-${end}/${size}`, "content-length": String(end - start + 1) }
  });
}

function serve(port: number, cors: boolean) {
  Bun.serve({
    port,
    error(e) { console.error(e); return new Response(String(e?.stack ?? e), { status: 500 }); },
    async fetch(req) {
      const url = new URL(req.url);
      const p = url.pathname;
      if (p === "/" || p === "/probe.html") return new Response(Bun.file(join(dir, "probe.html")), { headers: { "content-type": "text/html" } });
      if (p === "/recorder.js") return new Response(Bun.file(join(dir, "recorder.js")), { headers: { "content-type": "text/javascript" } });
      if (p.startsWith("/range/")) return media(req, p.slice(7), true, cors);
      if (p.startsWith("/norange/")) return media(req, p.slice(9), false, cors);
      return new Response("missing", { status: 404 });
    }
  });
}
serve(8796, true);
serve(8797, false);
console.log("probe server on 8796 (page, CORS) and 8797 (no CORS)");
