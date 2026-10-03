/**
 * Run B: the planned production command. Our scanner decides keys, bundles, tiers, nine-slice and
 * fonts; this script stages one folder per bundle (atlas groups, loose, fonts, audio), lets
 * AssetPack pack, compress and hash it, and maps the result back to OUR manifest
 * (`atlas: { page, x, y, width, height }` plus a VRAM estimate per bundle).
 *
 *   bun pack.ts                     cold build (cache off), the recommended config
 *   bun pack.ts --cache             same with the AssetPack cache on
 *   bun pack.ts --trim              AssetPack defaults: trim + rotation on (to see what breaks)
 *   bun pack.ts --lossless          PNG without palette quantisation, WebP lossless
 *   bun pack.ts --out=name          output folder name under out/
 */
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { type Asset, AssetPack, findAssets } from "@assetpack/core";
import { cacheBuster } from "@assetpack/core/cache-buster";
import { compress } from "@assetpack/core/image";
import { json } from "@assetpack/core/json";
import { pixiManifest } from "@assetpack/core/manifest";
import {
  texturePacker,
  texturePackerCacheBuster,
  texturePackerCompress
} from "@assetpack/core/texture-packer";
import sharp from "sharp";
import { scanAssets } from "../../src/assets";

const args = new Set(process.argv.slice(2));
const flag = (name: string) => args.has(`--${name}`);
const outName =
  [...args].find(a => a.startsWith("--out="))?.slice(6) ??
  (flag("trim") ? "trim" : flag("lossless") ? "lossless" : flag("webp-only") ? "webp-only" : "prod");

const FIXTURE = path.resolve(import.meta.dir, "../../tests/integration/merge-game");
const INPUT = path.resolve(import.meta.dir, "input"); // the copy of the art: input/features/...
const STAGE = path.resolve(import.meta.dir, `stage/${outName}`);
const OUT = path.resolve(import.meta.dir, `out/${outName}`);
const CACHE = path.resolve(import.meta.dir, `.assetpack/${outName}`);

/** Page size. 2048 is safe on every WebGPU adapter (limit is 8192). */
const PAGE = Number([...args].find(a => a.startsWith("--page="))?.slice(7) ?? 2048);
/** A texture with a side above this stays a loose file: full-screen backgrounds. */
const LOOSE_SIDE = Number([...args].find(a => a.startsWith("--loose="))?.slice(8) ?? 1024);
/** Atlas groups inside a bundle, by file stem. `fx` must stay one page. */
const ATLAS_GROUP = (stem: string) => (stem.startsWith("fx-") ? "fx" : "main");
/** Per-file bundle override (what `defineBundles({ "board.rings": { files } })` does). */
const OVERRIDES: Record<string, { tier: string; match: RegExp }> = {
  "board.rings": { tier: "lazy", match: /^features\/board\/assets\/selection-ring-\d\.webp$/ }
};

type V1File = {
  key: string;
  path: string;
  kind?: "font" | "audio";
  width?: number;
  height?: number;
  mb: number;
  pages?: { path: string; width: number; height: number; mb: number }[];
  nine?: { left: number; top: number; right: number; bottom: number };
};

const timings: Record<string, number> = {};
const lap = async <T>(name: string, run: () => Promise<T>): Promise<T> => {
  const t = performance.now();
  const result = await run();
  timings[name] = Math.round(performance.now() - t);
  return result;
};

// 1. Our scanner, read only: keys, bundles, tiers, nine, fonts. ------------------------------
const scan = await lap("scan", () =>
  scanAssets({
    root: FIXTURE,
    manifest: path.join(FIXTURE, "manifest.json"),
    keys: path.join(FIXTURE, "generated/assets.ts"),
    write: false
  })
);

const bundles = new Map<string, { feature: string; tier: string; files: V1File[] }>();
for (const [name, bundle] of Object.entries(scan.manifest.bundles)) {
  for (const file of bundle.files as V1File[]) {
    const override = Object.entries(OVERRIDES).find(([, o]) => o.match.test(file.path));
    const target = override?.[0] ?? name;
    const tier = override?.[1].tier ?? bundle.tier;
    if (!bundles.has(target)) bundles.set(target, { feature: bundle.feature, tier, files: [] });
    bundles.get(target)?.files.push(file);
  }
}

// 2. Stage: one folder per bundle. Names are keys, so no tag reaches AssetPack. --------------
const staged = new Set<string>();
const writeIfChanged = async (file: string, bytes: Uint8Array) => {
  staged.add(file);
  const old = await readFile(file).catch(() => undefined);
  if (old && Buffer.compare(old, Buffer.from(bytes)) === 0) return;
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, bytes);
};
const stemOf = (key: string) => key.slice(key.lastIndexOf(".") + 1);
const placement = new Map<string, "atlas" | "loose">();
const oversize = (file: V1File) => (file.width ?? 0) > LOOSE_SIDE || (file.height ?? 0) > LOOSE_SIDE;
/** How many textures each atlas group would get: a group of one is no atlas, it stays loose. */
const groupSize = new Map<string, number>();
for (const [name, bundle] of bundles)
  for (const file of bundle.files)
    if (!file.kind && !oversize(file)) {
      const id = `${name}/${ATLAS_GROUP(stemOf(file.key))}`;
      groupSize.set(id, (groupSize.get(id) ?? 0) + 1);
    }

await lap("stage", async () => {
  await Promise.all(
    [...bundles].flatMap(([name, bundle]) =>
      bundle.files.map(async file => {
        const source = path.join(INPUT, file.path);
        if (file.kind === "audio") {
          await writeIfChanged(path.join(STAGE, name, "audio", `${file.key}.mp3`), await readFile(source));
          return;
        }
        // Fonts never enter AssetPack: its cacheBuster would rename the page and leave the .fnt
        // pointing at the old name. Step 4 copies and hashes them straight into the output.
        if (file.kind === "font") return;
        // The packer globs *.{jpg,png,gif} only: a .webp source must be decoded to PNG first.
        const png = await sharp(await readFile(source)).png({ compressionLevel: 1 }).toBuffer();
        const loose = oversize(file) || groupSize.get(`${name}/${ATLAS_GROUP(stemOf(file.key))}`) === 1;
        placement.set(file.key, loose ? "loose" : "atlas");
        const folder = loose ? "loose" : `atlas-${ATLAS_GROUP(stemOf(file.key))}`;
        await writeIfChanged(path.join(STAGE, name, folder, `${file.key}.png`), png);
      })
    )
  );
  // drop stage files that are no longer planned
  const walk = async (dir: string): Promise<string[]> =>
    (await readdir(dir, { withFileTypes: true }).catch(() => [])).flatMap(e =>
      e.isDirectory() ? [] : [path.join(dir, e.name)]
    ).concat(
      ...(await Promise.all(
        (await readdir(dir, { withFileTypes: true }).catch(() => []))
          .filter(e => e.isDirectory())
          .map(e => walk(path.join(dir, e.name)))
      ))
    );
  for (const file of await walk(STAGE)) if (!staged.has(file)) await rm(file);
});

// 3. AssetPack. ------------------------------------------------------------------------------
const cache = flag("cache");
const trim = flag("trim");
const lossless = flag("lossless");
const pngOptions = lossless ? { palette: false, compressionLevel: 9 } : { quality: 90 };
const webpOptions = lossless ? { lossless: true } : { quality: 80, alphaQuality: 80 };

const pack = new AssetPack({
  entry: STAGE,
  output: OUT,
  cache,
  cacheLocation: CACHE,
  logLevel: "warn",
  strict: flag("strict"),
  assetSettings: [
    { files: ["*"], settings: {}, metaData: { m: true } },
    { files: ["*/atlas-*"], settings: {}, metaData: { tps: true } }
  ],
  pipes: [
    texturePacker({
      resolutionOptions: { resolutions: { default: 1 }, maximumTextureSize: PAGE },
      texturePacker: {
        nameStyle: "relative",
        removeFileExtension: true,
        allowTrim: trim,
        allowRotation: trim,
        autodetectAnimations: false,
        padding: 2
      }
    }),
    compress({ png: flag("webp-only") ? "skip" : pngOptions, webp: webpOptions, jpg: false, avif: false }),
    texturePackerCompress({ png: !flag("webp-only"), webp: true, avif: false }),
    json(),
    cacheBuster(),
    texturePackerCacheBuster(),
    pixiManifest({ output: "pixi-manifest.json", createShortcuts: false, trimExtensions: false })
  ]
});
await lap("assetpack", () => pack.run());

// 4. Post-process: AssetPack output -> OUR manifest. -------------------------------------------
const rel = (p: string) => path.relative(OUT, p).split(path.sep).join("/");
const finals = (asset: Asset | undefined) => asset?.getFinalTransformedChildren().map(a => a.path) ?? [];
const byStaged = (p: string) => findAssets(a => a.path === p, pack.rootAsset, true)[0];
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("base64url").slice(0, 8);
const round = (n: number) => Math.round(n * 1000) / 1000;
const mbOf = (w: number, h: number) => round((w * h * 4) / 1_048_576);

type Frame = { frame: { x: number; y: number; w: number; h: number }; rotated: boolean; trimmed: boolean; sourceSize: { w: number; h: number } };
const problems: string[] = [];
const v2: { version: 2; bundles: Record<string, unknown> } = { version: 2, bundles: {} };

await lap("post", async () => {
  for (const [name, bundle] of [...bundles].toSorted(([a], [b]) => a.localeCompare(b))) {
    const pages: { id: string; png: string | null; webp: string; width: number; height: number; mb: number }[] = [];
    const frames = new Map<string, { page: string; frame: Frame }>();

    // atlas groups of this bundle
    const dir = path.join(STAGE, name);
    const groups = (await readdir(dir)).filter(d => d.startsWith("atlas-"));
    for (const group of groups) {
      // texturePacker gives one (page, json) pair per page; each json then becomes .png.json and
      // .webp.json (texturePackerCompress) and is hashed (cacheBuster + texturePackerCacheBuster).
      const sheets = byStaged(path.join(dir, group)).transformChildren.filter(a => a.extension === ".json");
      if (group === "atlas-fx" && sheets.length !== 1)
        problems.push(`${name}: the fx atlas has ${sheets.length} pages, expected 1.`);
      for (const sheet of sheets) {
        const index = Number(sheet.transformData.page ?? 0);
        const outs = sheet.getFinalTransformedChildren().map(a => a.path);
        const webpJson = outs.find(f => f.endsWith(".webp.json")) ?? "?";
        const pngJson = outs.find(f => f.endsWith(".png.json")) ?? "?";
        const webpSheet = JSON.parse(await readFile(webpJson, "utf8"));
        const pngSheet = pngJson === "?" ? undefined : JSON.parse(await readFile(pngJson, "utf8"));
        const id = `${name}/${group.slice(6)}-${index}`;
        const { w, h } = webpSheet.meta.size;
        pages.push({
          id,
          png: pngSheet ? rel(path.join(path.dirname(pngJson), pngSheet.meta.image)) : null,
          webp: rel(path.join(path.dirname(webpJson), webpSheet.meta.image)),
          width: w,
          height: h,
          mb: mbOf(w, h)
        });
        for (const [key, frame] of Object.entries(webpSheet.frames as Record<string, Frame>)) frames.set(key, { page: id, frame });
      }
    }

    const files = [];
    for (const file of bundle.files.toSorted((a, b) => a.key.localeCompare(b.key))) {
      if (file.kind === "audio") {
        const [out] = finals(byStaged(path.join(dir, "audio", `${file.key}.mp3`)));
        files.push({ key: file.key, path: rel(out ?? "?"), kind: "audio", mb: file.mb });
        continue;
      }
      if (file.kind === "font") {
        // Our own copy + content hash, rewriting `file="..."` in the .fnt. Written next to the
        // AssetPack output, never over it: deleting an AssetPack output breaks its cache.
        const fontDir = path.join(OUT, name, "fonts");
        await mkdir(fontDir, { recursive: true });
        let fnt = await readFile(path.join(INPUT, file.path), "utf8");
        const outPages = [];
        for (const page of file.pages ?? []) {
          const base = path.basename(page.path);
          const bytes = await readFile(path.join(INPUT, page.path));
          const hashed = base.replace(/\.png$/, `-${sha(bytes)}.png`);
          await writeFile(path.join(fontDir, hashed), bytes);
          fnt = fnt.replaceAll(`"${base}"`, `"${hashed}"`);
          outPages.push({ ...page, path: `${name}/fonts/${hashed}` });
        }
        const fntName = path.basename(file.path).replace(/\.fnt$/, `-${sha(Buffer.from(fnt))}.fnt`);
        await writeFile(path.join(fontDir, fntName), fnt);
        files.push({ key: file.key, path: `${name}/fonts/${fntName}`, kind: "font", mb: file.mb, pages: outPages });
        continue;
      }
      const base = { key: file.key, width: file.width, height: file.height, ...(file.nine ? { nine: file.nine } : {}) };
      const hit = frames.get(file.key);
      if (hit) {
        const { frame, rotated, trimmed, sourceSize } = hit.frame;
        if (rotated) problems.push(`${file.key}: rotated in the atlas.`);
        if (trimmed) problems.push(`${file.key}: trimmed ${sourceSize.w}x${sourceSize.h} -> ${frame.w}x${frame.h}${file.nine ? " (nine-slice!)" : ""}.`);
        files.push({ ...base, mb: 0, atlas: { page: hit.page, x: frame.x, y: frame.y, width: frame.w, height: frame.h } });
        continue;
      }
      const outs = finals(byStaged(path.join(dir, "loose", `${file.key}.png`)));
      if (outs.length === 0) problems.push(`${file.key}: no output (its atlas failed?).`);
      files.push({
        ...base,
        path: rel(outs.find(f => f.endsWith(".webp")) ?? "?"),
        png: outs.find(f => f.endsWith(".png")) ? rel(outs.find(f => f.endsWith(".png")) ?? "") : null,
        mb: mbOf(file.width ?? 0, file.height ?? 0)
      });
    }
    const mb = round(pages.reduce((s, p) => s + p.mb, 0) + files.reduce((s, f) => s + f.mb, 0));
    const v1mb = round(bundle.files.reduce((s, f) => s + f.mb, 0));
    v2.bundles[name] = { feature: bundle.feature, tier: bundle.tier, mb, v1mb, pages, files };
  }
  await writeFile(path.join(OUT, "manifest.json"), `${JSON.stringify(v2, null, 2)}\n`);
});

// 5. Sizes. ----------------------------------------------------------------------------------
const sizeOf = async (dir: string, test: (f: string) => boolean): Promise<number> => {
  let total = 0;
  for (const e of await readdir(dir, { withFileTypes: true, recursive: true })) {
    const full = path.join(e.parentPath, e.name);
    if (e.isFile() && test(full)) total += (await stat(full)).size;
  }
  return total;
};
const texturesOut = (ext: string) => (f: string) => f.endsWith(ext) && !f.includes(`${path.sep}fonts${path.sep}`);
const sizes = {
  outPng: await sizeOf(OUT, texturesOut(".png")),
  outWebp: await sizeOf(OUT, texturesOut(".webp")),
  outJson: await sizeOf(OUT, f => f.endsWith(".json") && !f.endsWith("manifest.json")),
  pages: Object.values(v2.bundles).reduce((s: number, b) => s + (b as { pages: unknown[] }).pages.length, 0)
};

const report = { out: outName, cache, trim, lossless, timings, sizes, problems };
await writeFile(path.join(import.meta.dir, `metrics-${outName}${cache ? "-cache" : ""}.json`), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
