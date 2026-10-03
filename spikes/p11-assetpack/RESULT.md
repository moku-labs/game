# P11 result

Question: can `@assetpack/core` be the core of the production asset command, under Bun with no Vite, and can its output be mapped to our manifest (`atlas: { page, x, y, width, height }`), with PNG + WebP, hashed paths, typed keys, per-file bundles, a one-page fx atlas, 9-slice metadata and a VRAM estimate per bundle?

Answer: changes. AssetPack 1.7.0 runs under Bun with no Vite. It works as the packer behind our command, but only behind a staging step that our command owns. Five beliefs change: the packer skips `.webp` sources, a font breaks under its hash pipe, its cache leaves stale pages, a texture larger than the page is silently dropped, and its "PNG" is palette-lossy. The runtime reads OUR manifest. The AssetPack JSON is a build-time intermediate and never ships.

## Evidence

Input: a copy of `tests/integration/merge-game/features/*/assets` (`input/`, 47 textures, 2 fonts, 7 mp3). All sources are lossy `.webp`. Bun 1.3.14, macOS arm64, sharp 0.34.5. Scripts: `run-raw.ts`, `pack.ts`, `run-tags.ts`, `bench.ts`, `watch.ts`, `sizes.ts`, `quality.ts`, `direct.ts`. Numbers: `metrics-*.json`, `bench.json`, `sizes.json`, `quality.json`.

### 1. Package, runtime, pipes

| Item | Result |
|---|---|
| Latest version | `@assetpack/core` 1.7.0, published 2025-11-07. `dev` tag 1.7.0-dev. |
| Install with bun | `bun add` 30 s. 263 packages, **238 MB** `node_modules`. Hard deps include ffmpeg (36 MB), gpu-tex-enc (75 MB) and msdf-bmfont (18 MB). We use none of them. 0 untrusted install scripts. |
| Programmatic API under Bun | `new AssetPack(config).run()` and `.watch()` both work. sharp loads its prebuilt `@img` binary. chokidar 4 watches. No Node and no Vite involved. |
| Pipes used | `texturePacker`, `compress`, `texturePackerCompress`, `json`, `cacheBuster`, `texturePackerCacheBuster`. `pixiManifest` is optional and only for comparison. |
| Pipes not used | `audio` (ffmpeg), `mipmap`, `webfont`, `spine*`. `pixiPipes()` is not used: its defaults add `@0.5x` sheets, palette PNG and `nameStyle: short`. |
| Packer internals | `maxrects-packer` 2.7.3 + sharp. `packTextures()` is not in the package `exports`, so it cannot be called alone. |

### 2. What AssetPack does with our tree

Run A (`run-raw.ts`): the fixture tree as it is, with every `features/*/assets` folder marked `{m}{tps}` through `assetSettings`. No folder was renamed.

| Observation | Detail |
|---|---|
| `.webp` sources | **Silently skipped.** The packer globs `*.{jpg,png,gif}`. 4 of 5 bundles came out empty. |
| Children of a `{tps}` folder that are not images | **Dropped.** All `.mp3` and both `.fnt` files vanished. |
| Font pages | Packed into the ui atlas as frames. The fonts are broken. |
| Bundle names | Folder name. 5 folders named `assets` collide: a warning, then renamed to `ui/assets` and so on. |
| AssetPack manifest | `{ bundles: [{ name, assets: [{ alias: ["ui/assets"], src: ["ui/assets-z7KmGw.webp.json", "ui/assets-OA7z.png.json"], data: { tags } }] }] }`. One entry per atlas. No frame keys. |

Run C (`run-tags.ts`): our file names fed in unchanged.

| Name | Loose file | Inside `{tps}` |
|---|---|---|
| `board-tray{nine=96,96,96,96}.png` | Output `board-tray-<hash>.png`. `data.nine` is the **string** `"96,96,96,96"`, because AssetPack splits arrays on `&`. | Frame `board-tray.png`. **Nine lost**: frames carry no metadata. |
| `panel{nine=48}.png` | `data.nine` is the **number** `48`. | |
| `icon{atlas=ui}{fix}.png` | `{fix}` is an AssetPack texturePacker tag and was obeyed. | |

Conclusion: `{nine=…}` does not collide by name. But AssetPack reads every `{word}` as its own tag. Its reserved words: `m`, `tps`, `fix`, `jpg`, `nomip`, `nc`, `copy`, `ignore`, `mIgnore`, `wf`, `sdf`, `msdf` and the spine ones. Any of them in a game file name would change the build. Run B never shows a tag to AssetPack, because staged files are named by key.

Run B (`pack.ts`), the planned command:

1. **Scan.** Our `scanAssets(write: false)` gives keys, bundles, tiers, nine and fonts. It runs as is under Bun: 23 ms.
2. **Stage.** One folder per OUR bundle, under `stage/<out>/`:
   - `<bundle>/atlas-<group>/<key>.png`: each source decoded to PNG.
   - `<bundle>/loose/<key>.png`
   - `<bundle>/audio/<key>.mp3`
   Only changed bytes are written, so the cache holds.
3. **Pack.** AssetPack with `assetSettings` `*` → `{m}`, `*/atlas-*` → `{tps}`.
4. **Post-process**, about 100 lines:
   - Read the asset tree with `pack.rootAsset` and `getFinalTransformedChildren()`.
   - Write our manifest.
   - Copy and hash the fonts ourselves.
   - Check that every key landed.
   - Check that the fx atlas has one page.

| Per-file bundle override | Works. `board.rings` = `selection-ring-*` (tier `lazy`) became its own folder, so it got its own atlas page. AssetPack has no native way to move one file into a named bundle. A bundle is the nearest `{m}` folder, and a file tagged `{m}` becomes a bundle named after the file. |
|---|---|
| fx atlas | `ui/atlas-fx`: 1 page, 595×516. With `--page=512` it went to 2 pages and the check fired. |
| Fonts | They must stay out of AssetPack. `cacheBuster` renames the page PNG and leaves `file="font-body.png"` in the `.fnt`. Our post-process hashes the page, rewrites the `.fnt`, then hashes the `.fnt`. |
| Output layout | `board/atlas-main-Lm73IQ.webp` + `.png` + `.webp.json` + `.png.json`, `board/loose/board.bg-forest-meadow-5hep3Q.webp`, `ui/audio/ui.click-y4Cysg.mp3`. A hash can contain `-`, so file names cannot be parsed back. Use the asset tree. |

### 3. Mapping to our manifest, 3 real keys (`out/prod/manifest.json`)

| Key | AssetPack frame (`*.webp.json`) | Our file entry | Page entry (once per bundle) |
|---|---|---|---|
| `board.cell` (9-slice) | `board/atlas-main-hBp2BA.webp.json`: `{x:260, y:2, w:224, h:219}`, `rotated:false`, `trimmed:false` | `{ key, width:224, height:219, nine:{44,52,44,52}, mb:0, atlas:{ page:"board/main-0", x:260, y:2, width:224, height:219 } }` | `{ id:"board/main-0", webp:"board/atlas-main-Lm73IQ.webp", png:"board/atlas-main-nNjICw.png", width:744, height:1144, mb:3.247 }` |
| `ui.icon-coin` | `ui/atlas-main-3kbyJA.webp.json`: `{x:583, y:595, w:154, h:160}` | `atlas:{ page:"ui/main-0", x:583, y:595, width:154, height:160 }` | `{ id:"ui/main-0", webp:"ui/atlas-main-X98nVw.webp", width:966, height:1365, mb:5.03 }` |
| `ui.fx-sparkle` | `ui/atlas-fx-ljuanQ.webp.json`: `{x:2, y:2, w:85, h:96}` | `atlas:{ page:"ui/fx-0", x:2, y:2, width:85, height:96 }` | `{ id:"ui/fx-0", webp:"ui/atlas-fx-2oMkhA.webp", width:595, height:516, mb:1.171 }` |

All 42 atlas frames have the same width and height as the source, 14 of them nine-slice, so the nine borders stay valid as they are.

Pixi's own spritesheet loading was rejected for these reasons:
- `assets` would have to import `pixi.js`.
- It bypasses the `io` seam, so the fake fetch of the tests no longer works.
- It bypasses per-file progress, abort signals and budget unload.
- It adds one JSON request per page.

The `AtlasFrame` shape fits as it is. `page` becomes a page id, not a file name, because each format has its own hash.

### 4. Sizes and VRAM (textures only; fonts and audio are equal in every mode)

| Mode | Files the runtime fetches | PNG bytes | WebP bytes |
|---|---|---|---|
| Sources as shipped (lossy webp) | 47 | | 1 201 712 |
| Loose, PNG lossless | 47 | 11 269 129 | |
| Loose, PNG `{quality:90}` (palette) | 47 | 3 006 575 | |
| Loose, WebP q80 | 47 | | 921 904 |
| **Packed, AssetPack defaults** (PNG palette q90 + WebP q80) | **10** (5 pages + 5 loose) | 2 930 169 | **913 882** |
| Packed, lossless (PNG `palette:false`, WebP lossless) | 10 | 11 132 197 | 6 247 034 |
| Packed, trim + rotation on | 10 | 2 960 059 | 917 898 |
| Control: `direct.ts`, maxrects-packer + sharp, no AssetPack (atlases only) | 5 pages | 963 159 | 406 024 |
| Same atlases through AssetPack | 5 pages | 954 784 | 403 186 |

Packing does not save bytes. WebP q80 is 0.92 MB loose and 0.91 MB packed. It saves requests: 47 down to 10.

Encoder quality, PSNR on premultiplied RGBA against the lossless page (`quality.json`):

| Page | PNG `{quality:90}` | WebP q80 |
|---|---|---|
| board/main-0 | 42.3 dB | 39.7 dB |
| ui/main-0 | 41.4 dB | 41.6 dB |
| ui/fx-0 | 47.2 dB | 46.3 dB |

The AssetPack PNG is about as lossy as WebP q80 and 3.2 times larger.

VRAM estimate per bundle in MB. Pages count once, loose textures are `w × h × 4`, and an atlas file is 0.

| Bundle | v1 (file by file) | Packed, side > 1024 loose | Packed, side > 512 loose |
|---|---|---|---|
| board | 8.854 | 9.257 | 9.001 |
| board.rings | 1.372 | 1.401 | 1.401 |
| home | 9.513 | **11.369** (home-yard 960×924 + sign-post 64×530 on a 964×1460 page) | 9.513 |
| orders | 0.673 | 0.673 (atlas of one goes loose) | 0.673 |
| splash | 6 | 6 | 6 |
| ui | 7.348 | 8.865 | 8.865 |
| **Total** | **33.760** | **37.565 (+11%)** | **35.453 (+5%)** |

Packing costs VRAM. It never saves any here, because the art is already tight: trim cut 1 texture out of 47, `ui.link-wave` 400×16 to 400×13.

Build time. Each run is a fresh `bun pack.ts`, so Bun start and imports are included. Wall time in ms.

| Run | Wall | Stage | AssetPack |
|---|---|---|---|
| cold 1 / 2 / 3 (`cache:false`) | 970 / 979 / 961 | 126 / 123 / 110 | 736 / 750 / 739 |
| cache miss | 972 | 115 | 745 |
| cache warm, no change | 259 | 138 | **14** |
| cache, `ui.icon-coin` changed (repacks ui main, 26 frames) | 615 | 112 | 404 |
| cache, `board.selection-ring-2` changed (repacks board.rings, 4 frames) | 302 | 133 | 68 |
| WebP only (`png: "skip"`), cold | | | **257** |
| trim + rotation, cold | | | 1 090 |

PNG palette quantisation is about two thirds of the cold build.

### 5. Watch, cache, and what breaks

| Case | Result |
|---|---|
| `watch()` under Bun (`watch.ts`) | Works. The first build takes 1.35 s. A fixed **500 ms debounce** is built in. From write to `onComplete`: change 894 ms, add 912 ms, delete 978 ms, rename 1011 ms. |
| Stale outputs | **Stale pages stay on disk.** With the cache, in `run()` and in `watch()`, a repacked atlas leaves its old hashed page + JSON set behind: 4 files per change. After 3 watch edits, `ui/` held 16 `atlas-main-*` files instead of 4. Our command must prune the output to what our manifest references. |
| Writing into AssetPack output | **Breaks the cache.** Deleting an AssetPack output (as the first font post-process did) makes the next cached run fail with `ENOENT`. Our files go next to its output, never over it. |
| Texture larger than the page (`--page=512`) | **Silently dropped**, with no error even in strict mode. `ui.fx-rays` 504×512 and `ui.panel-signboard` 512×505 left an empty second fx page. Other atlases failed with `Expected valid width, height and channels`. `run()` still resolves, and only `strict: true` makes the process exit 1. Our "every key landed" check caught all 11 missing keys. |
| Rotation on (AssetPack default `allowRotation: true`) | 18 frames rotated. **11 of the 14 nine-slice frames in an atlas were rotated**: board-tray, cell, bar-fill, bar-track, button-berry, button-disabled, hud-pill, panel-parchment, panel-signboard, tab-active, tab-idle. Nine-slice on a rotated frame is wrong. |
| Trim on (default `allowTrim: true`) | 1 frame trimmed, no nine-slice among them. It cost +47% build time and +3% page area in total. A trimmed nine-slice would shift its borders. |
| Atlas of one texture | `orders` (only `card-order`) gave a 218×304 page for one file. Our command sends a group of one to loose. |

## What changes for the design

1. **Manifest v2.** `version: 2` with these changes:
   - `bundle.pages: [{ id, path, width, height, mb }]`, where `path` is the hashed WebP.
   - `file.atlas: { page: <page id>, x, y, width, height }`.
   - An atlas file has `mb: 0`, and the bundle `mb` is pages plus loose files.
   - `atlas` stops being refused.
   - The `AtlasFrame` JSDoc example changes from `page: "ui-0.png"` to a page id `"ui/main-0"`.
2. **Runtime.** The `assets` plugin loads a page through `io` like any texture. `renderer.sync.textures` gets one new call that makes a frame texture over a page source. Unload destroys the page. No Pixi spritesheet loader, and the AssetPack JSON is never fetched.
3. **The production command** owns, in order:
   - scan
   - stage by OUR bundles, named by key, `.webp` decoded to PNG
   - AssetPack
   - post-process: every key landed, fx one page, fonts hashed by us, prune stale outputs, VRAM per bundle
   
   No `pixiManifest`, no `audio` pipe and no `mipmap`.
4. **Packing rules**:
   - `allowTrim: false` and `allowRotation: false` for every atlas.
   - padding 2, page 2048.
   - Loose when a side is above 512. That is +5% VRAM against +11% at 1024.
   - A group of one goes loose.
   - `fx-*` is its own atlas group with the one-page check.
5. **Formats.** Ship **WebP only**: every browser that runs WebGPU decodes WebP. With `png: "skip"` the build drops from 736 to 257 ms. A PNG page is never picked at runtime, and the AssetPack default PNG is palette-lossy. If a lossless page is ever needed, the cost is WebP lossless at 6.2 MB.
6. **Dev stays loose.** The current V2 pipeline is unchanged and instant. AssetPack `watch()` is not used: it adds a 500 ms debounce and stale pages.
7. **Dependency.** `@assetpack/core` (238 MB) is a devDependency of the game, or an optional peer of the command. It is never a dependency of `@moku-labs/game`. The control shows `maxrects-packer` + `sharp` (about 17 MB) give the same pages and bytes. What AssetPack adds here is its content-hash cache: 14 ms warm.

Recommended config, as run in `bun pack.ts --webp-only --strict --cache` (exit 0, no problems):

```ts
new AssetPack({
  entry: "stage", output: "dist/assets", cache: true, cacheLocation: ".assetpack", strict: true,
  assetSettings: [
    { files: ["*"], settings: {}, metaData: { m: true } },
    { files: ["*/atlas-*"], settings: {}, metaData: { tps: true } }
  ],
  pipes: [
    texturePacker({
      resolutionOptions: { resolutions: { default: 1 }, maximumTextureSize: 2048 },
      texturePacker: { nameStyle: "relative", removeFileExtension: true, allowTrim: false,
        allowRotation: false, autodetectAnimations: false, padding: 2 }
    }),
    compress({ png: "skip", webp: { quality: 80, alphaQuality: 80 }, jpg: false, avif: false }),
    texturePackerCompress({ png: false, webp: true, avif: false }),
    json(),
    cacheBuster(),
    texturePackerCacheBuster()
  ]
});
```

## What was NOT checked

- No rendering in a browser. Not seen:
  - a `NineSliceSprite` on an atlas frame texture
  - edge bleeding of 2 px transparent padding under linear filtering (AssetPack has no extrude option)
  - banding of the palette PNG by eye
- Only 47 textures. Hundreds of files, multi-page main atlases and the timing of a real game were not measured.
- Only macOS arm64. sharp and AssetPack on Linux CI and Windows were not run.
- Mipmaps, `@0.5x` resolutions, the AssetPack audio pipe, and `bun build --compile` of the command.
- The editor reading manifest v2, and the `assets` runtime changes themselves.
- The sources are already lossy WebP, so q80 is a second generation of loss. With PNG masters the WebP bytes and PSNR will differ.

To rerun: `bun pack.ts [--cache|--trim|--lossless|--webp-only|--page=N|--loose=N]`. Then `bun bench.ts`, `bun sizes.ts`, `bun quality.ts` (needs `--lossless` output), `bun watch.ts` and `bun direct.ts` (both need `stage/prod`).
