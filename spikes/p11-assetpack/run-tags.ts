/**
 * Run C: do our `{nine=…}` file-name tags survive AssetPack, or collide with its own `{tag}` syntax?
 * Our names go in unchanged, loose and inside a `{tps}` folder.
 */
import { AssetPack } from "@assetpack/core";
import { cacheBuster } from "@assetpack/core/cache-buster";
import { compress } from "@assetpack/core/image";
import { pixiManifest } from "@assetpack/core/manifest";
import { texturePacker, texturePackerCacheBuster, texturePackerCompress } from "@assetpack/core/texture-packer";

await new AssetPack({
  entry: "tags-input",
  output: "out/tags",
  cache: false,
  logLevel: "warn",
  pipes: [
    texturePacker({ resolutionOptions: { resolutions: { default: 1 } }, texturePacker: { nameStyle: "relative", allowTrim: false, allowRotation: false } }),
    compress({ png: true, webp: true, jpg: false, avif: false }),
    texturePackerCompress({ png: true, webp: true }),
    cacheBuster(),
    texturePackerCacheBuster(),
    pixiManifest({ legacyMetaDataOutput: false })
  ]
}).run();
