/**
 * Watch probe: AssetPack.watch() under Bun on a staged tree. Measures the first build, then the
 * time from a file write to onComplete for: change one atlas frame, add a file, delete a file.
 * Prints which outputs exist afterwards, to see whether stale pages are removed.
 */
import { cp, readdir, rm, writeFile } from "node:fs/promises";
import { AssetPack } from "@assetpack/core";
import { cacheBuster } from "@assetpack/core/cache-buster";
import { compress } from "@assetpack/core/image";
import { json } from "@assetpack/core/json";
import { texturePacker, texturePackerCacheBuster, texturePackerCompress } from "@assetpack/core/texture-packer";
import sharp from "sharp";

await rm("stage/watch", { recursive: true, force: true });
await rm("out/watch", { recursive: true, force: true });
await rm(".assetpack/watch", { recursive: true, force: true });
await cp("stage/prod", "stage/watch", { recursive: true });

let done: (() => void) | undefined;
let builds = 0;
const pack = new AssetPack({
  entry: "stage/watch",
  output: "out/watch",
  cache: true,
  cacheLocation: ".assetpack/watch",
  logLevel: "warn",
  assetSettings: [
    { files: ["*"], settings: {}, metaData: { m: true } },
    { files: ["*/atlas-*"], settings: {}, metaData: { tps: true } }
  ],
  pipes: [
    texturePacker({ resolutionOptions: { resolutions: { default: 1 }, maximumTextureSize: 2048 }, texturePacker: { nameStyle: "relative", removeFileExtension: true, allowTrim: false, allowRotation: false, autodetectAnimations: false } }),
    compress({ png: { quality: 90 }, webp: { quality: 80, alphaQuality: 80 }, jpg: false, avif: false }),
    texturePackerCompress({ png: true, webp: true, avif: false }),
    json(),
    cacheBuster(),
    texturePackerCacheBuster()
  ]
});

const step = async (label: string, change: () => Promise<void>) => {
  const finished = new Promise<void>(resolve => (done = resolve));
  const t = performance.now();
  await change();
  const timeout = new Promise<string>(resolve => setTimeout(() => resolve("TIMEOUT"), 15000));
  const result = await Promise.race([finished.then(() => "ok"), timeout]);
  const files = (await readdir("out/watch/ui")).filter(f => f.startsWith("atlas-main"));
  console.log(JSON.stringify({ label, result, ms: Math.round(performance.now() - t), uiAtlasMainFiles: files.length }));
};

let t = performance.now();
await pack.watch(() => { builds++; done?.(); });
console.log(JSON.stringify({ label: "watch: first build", ms: Math.round(performance.now() - t) }));

const icon = "stage/watch/ui/atlas-main/ui.icon-coin.png";
await step("change ui.icon-coin", async () => {
  await writeFile(icon, await sharp(icon).modulate({ hue: 60 }).png().toBuffer());
});
await step("add ui.icon-new", async () => {
  await writeFile("stage/watch/ui/atlas-main/ui.icon-new.png", await sharp(icon).flop().png().toBuffer());
});
await step("delete ui.icon-new", async () => {
  await rm("stage/watch/ui/atlas-main/ui.icon-new.png");
});
await step("rename via restage (delete + add in one go)", async () => {
  await cp(icon, "stage/watch/ui/atlas-main/ui.icon-coin2.png");
  await rm(icon);
});
await pack.stop();
console.log(JSON.stringify({ builds, uiFiles: await readdir("out/watch/ui") }));
