/**
 * Run A: AssetPack on the fixture tree as it is. Every `features/<f>/assets` folder is marked as a
 * bundle `{m}` and an atlas `{tps}` through `assetSettings`, so no folder is renamed.
 * Question: what does AssetPack do with our tree, our webp sources, our `{nine=…}` names, fonts and mp3?
 */
import { AssetPack } from "@assetpack/core";
import { cacheBuster } from "@assetpack/core/cache-buster";
import { compress } from "@assetpack/core/image";
import { json } from "@assetpack/core/json";
import { pixiManifest } from "@assetpack/core/manifest";
import {
  texturePacker,
  texturePackerCacheBuster,
  texturePackerCompress
} from "@assetpack/core/texture-packer";

const cache = process.argv.includes("--cache");
const t0 = performance.now();
const pack = new AssetPack({
  entry: "input/features",
  output: "out/raw",
  cache,
  cacheLocation: ".assetpack/raw",
  logLevel: "info",
  assetSettings: [{ files: ["*/assets"], settings: {}, metaData: { m: true, tps: true } }],
  pipes: [
    texturePacker({
      resolutionOptions: { resolutions: { default: 1 }, maximumTextureSize: 2048 },
      texturePacker: { nameStyle: "relative", allowTrim: false, allowRotation: false, padding: 2 }
    }),
    compress({ png: true, webp: true, jpg: false, avif: false }),
    texturePackerCompress({ png: true, webp: true, avif: false }),
    json(),
    cacheBuster(),
    texturePackerCacheBuster(),
    pixiManifest({ output: "manifest.json", createShortcuts: false, trimExtensions: true, includeMetaData: true })
  ]
});
await pack.run();
console.log(`run-raw: ${(performance.now() - t0).toFixed(0)} ms (cache ${cache})`);
