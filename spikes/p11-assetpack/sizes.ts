/**
 * Bytes on the wire for the texture set (fonts and audio excluded, they are the same in every
 * mode): the loose baselines encoded file by file, against the packed outputs of pack.ts.
 */
import { readFile } from "node:fs/promises";
import sharp from "sharp";

const manifest = await Bun.file("../../tests/integration/merge-game/manifest.json").json();
const textures = Object.values(manifest.bundles as Record<string, { files: { key: string; path: string; kind?: string }[] }>)
  .flatMap(b => b.files)
  .filter(f => !f.kind);

const totals = { files: textures.length, sourceWebp: 0, pngLossless: 0, pngPalette90: 0, webpQ80: 0, webpLossless: 0 };
for (const file of textures) {
  const bytes = await readFile(`input/${file.path}`);
  totals.sourceWebp += bytes.length;
  const image = sharp(bytes);
  totals.pngLossless += (await image.clone().png({ compressionLevel: 9, palette: false }).toBuffer()).length;
  totals.pngPalette90 += (await image.clone().png({ quality: 90 }).toBuffer()).length;
  totals.webpQ80 += (await image.clone().webp({ quality: 80, alphaQuality: 80 }).toBuffer()).length;
  totals.webpLossless += (await image.clone().webp({ lossless: true }).toBuffer()).length;
}
const packed: Record<string, unknown> = {};
for (const name of ["prod", "webp-only", "lossless", "trim", "loose512"]) {
  const m = await Bun.file(`out/${name}/manifest.json`).json().catch(() => undefined);
  if (!m) continue;
  packed[name] = (await Bun.file(`metrics-${name}.json`).json()).sizes;
  const files = Object.values(m.bundles as Record<string, { pages: unknown[]; files: { kind?: string; atlas?: unknown }[] }>);
  (packed[name] as Record<string, number>).requests =
    files.reduce((s, b) => s + b.pages.length + b.files.filter(f => !f.kind && !f.atlas).length, 0);
}
console.log(JSON.stringify({ loose: totals, packed }, null, 2));
await Bun.write("sizes.json", `${JSON.stringify({ loose: totals, packed }, null, 2)}\n`);
