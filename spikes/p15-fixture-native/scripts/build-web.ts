/** P15: bundle the fixture page with the probe, then copy the packed assets to the static root. */
import { cpSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.join(import.meta.dir, "..");
const dist = path.join(root, "dist");
rmSync(dist, { recursive: true, force: true });

const result = await Bun.build({ entrypoints: [path.join(root, "web/index.html")], outdir: dist, minify: true });
if (!result.success) {
  console.error(result.logs);
  process.exit(1);
}

// The page fetches /manifest.json: the pack folder is the static root, as `serve.ts --packed` serves it.
cpSync(path.join(root, "pack"), dist, { recursive: true });

// A KTX2 file with the real 12-byte identifier, to see the MIME the Tauri protocol sends for it.
const ktx2 = new Uint8Array([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
writeFileSync(path.join(dist, "probe.ktx2"), ktx2);
console.log("built", result.outputs.map(o => path.relative(root, o.path)).join(", "));
