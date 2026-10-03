/**
 * How lossy are the default encoders? PSNR on premultiplied RGBA (a transparent pixel counts as
 * black, so encoders that rewrite hidden RGB are not punished) of the AssetPack defaults —
 * PNG `{ quality: 90 }` (palette) and WebP q80 — against the lossless page, paired by page id.
 */
import sharp from "sharp";

type Page = { id: string; png: string; webp: string };
const pagesOf = async (out: string) =>
  Object.values((await Bun.file(`out/${out}/manifest.json`).json()).bundles as Record<string, { pages: Page[] }>).flatMap(b => b.pages);
const pixels = async (file: string) => {
  const raw = await sharp(file).ensureAlpha().raw().toBuffer();
  for (let i = 0; i < raw.length; i += 4) {
    const a = (raw[i + 3] ?? 0) / 255;
    raw[i] = Math.round((raw[i] ?? 0) * a);
    raw[i + 1] = Math.round((raw[i + 1] ?? 0) * a);
    raw[i + 2] = Math.round((raw[i + 2] ?? 0) * a);
  }
  return raw;
};
const psnr = (a: Buffer, b: Buffer) => {
  let se = 0;
  for (let i = 0; i < a.length; i++) se += ((a[i] ?? 0) - (b[i] ?? 0)) ** 2;
  return 10 * Math.log10((255 * 255) / (se / a.length));
};
const lossless = await pagesOf("lossless");
const rows = [];
for (const page of await pagesOf("prod")) {
  const ref = lossless.find(p => p.id === page.id);
  if (!ref) continue;
  const base = await pixels(`out/lossless/${ref.png}`);
  rows.push({
    page: page.id,
    pngPalette90: psnr(base, await pixels(`out/prod/${page.png}`)).toFixed(1),
    webpQ80: psnr(base, await pixels(`out/prod/${page.webp}`)).toFixed(1),
    webpLossless: psnr(base, await pixels(`out/lossless/${ref.webp}`)).toFixed(1)
  });
}
console.table(rows);
await Bun.write("quality.json", `${JSON.stringify(rows, null, 2)}\n`);
