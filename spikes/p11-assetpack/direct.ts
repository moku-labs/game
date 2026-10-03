/**
 * Control: the same atlases without AssetPack — maxrects-packer + sharp straight from the staged
 * folders of pack.ts (stage/prod). Same packer options as AssetPack uses (smart, border 2,
 * padding 2, no rotation, no trim). Answers: what does AssetPack add over its two engines?
 */
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { MaxRectsPacker, type Rectangle } from "maxrects-packer";
import sharp from "sharp";

const STAGE = "stage/prod";
const OUT = "out/direct";
const PAGE = 2048;
const t0 = performance.now();
await rm(OUT, { recursive: true, force: true });
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("base64url").slice(0, 8);
const result: Record<string, unknown> = {};
let bytesPng = 0;
let bytesWebp = 0;

for (const bundle of await readdir(STAGE)) {
  for (const group of (await readdir(path.join(STAGE, bundle))).filter(d => d.startsWith("atlas-"))) {
    const dir = path.join(STAGE, bundle, group);
    const images = await Promise.all(
      (await readdir(dir)).map(async name => {
        const buffer = await readFile(path.join(dir, name));
        const { width = 0, height = 0 } = await sharp(buffer).metadata();
        return { key: name.replace(/\.png$/, ""), buffer, width, height };
      })
    );
    const packer = new MaxRectsPacker<Rectangle & { data: (typeof images)[number] }>(PAGE, PAGE, 2, { smart: true, pot: false, square: false, border: 2, allowRotation: false });
    for (const image of images) packer.add(image.width, image.height, image);
    const pages = [];
    for (const [index, bin] of packer.bins.entries()) {
      const oversized = bin.rects.filter(r => r.oversized).map(r => r.data.key);
      if (oversized.length > 0) throw new Error(`${bundle}/${group}: ${oversized.join(", ")} larger than the page`);
      const canvas = sharp({ create: { width: bin.width, height: bin.height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
        .composite(bin.rects.map(r => ({ input: r.data.buffer, left: r.x, top: r.y })));
      const raw = await canvas.png({ compressionLevel: 0 }).toBuffer();
      const [png, webp] = await Promise.all([
        sharp(raw).png({ quality: 90 }).toBuffer(),
        sharp(raw).webp({ quality: 80, alphaQuality: 80 }).toBuffer()
      ]);
      bytesPng += png.length;
      bytesWebp += webp.length;
      const base = `${group}-${index}`;
      await mkdir(path.join(OUT, bundle), { recursive: true });
      await writeFile(path.join(OUT, bundle, `${base}-${sha(png)}.png`), png);
      await writeFile(path.join(OUT, bundle, `${base}-${sha(webp)}.webp`), webp);
      pages.push({ width: bin.width, height: bin.height, frames: Object.fromEntries(bin.rects.map(r => [r.data.key, { x: r.x, y: r.y, width: r.width, height: r.height }])) });
    }
    result[`${bundle}/${group}`] = pages;
  }
}
const ms = Math.round(performance.now() - t0);
await writeFile("metrics-direct.json", `${JSON.stringify({ ms, bytesPng, bytesWebp, atlases: Object.fromEntries(Object.entries(result).map(([k, v]) => [k, (v as { width: number; height: number }[]).map(p => `${p.width}x${p.height}`)])) }, null, 2)}\n`);
console.log(await Bun.file("metrics-direct.json").text());
console.log("board.cell", JSON.stringify((result["board/atlas-main"] as { frames: Record<string, unknown> }[])[0]?.frames["board.cell"]));
