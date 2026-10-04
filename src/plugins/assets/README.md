# assets

> Complex plugin — the art of the game: bundles of textures by key, a graph-driven preload and a texture-memory budget.

The plugin knows which image files a game has (the manifest), loads them in bundles, hands textures
to `renderer` by key and keeps GPU memory under a budget. Bundles belong to features. Loading is
driven by the graph: the node being entered gets its bundles, the neighbourhood of a rest node is
preloaded in the background.

Nothing here imports `pixi.js`, not even dynamically. A texture is made by
`renderer.sync.textures.create`, a packed file is cut out of its atlas page by
`renderer.sync.textures.slice`, and both are freed by `renderer.sync.textures.destroy`; `types.ts`
only uses the texture *type*.

## API

| Method | Behaviour |
|---|---|
| `load(bundle): Promise<void>` | Loads every file of the bundle. Already loaded: resolves at once. Loading: joins the running load. Unknown bundle: rejects with `[game] assets: no bundle "bord" in the manifest.\n  Run "bun run assets:keys".` Headless: resolves at once, state untouched. |
| `unload(bundle): void` | Destroys the textures through `io.destroyTexture`, calls `renderer.sync.textures.invalidate` with the keys of the bundle, emits `assets:bundle-unloaded` with reason `"request"`. A pinned bundle and the tiers `boot` and `core` are refused with a `ctx.log.warn`. A running load is aborted. |
| `isLoaded(bundle): boolean` | `status === "loaded"`. Headless: `true` for every bundle of the manifest. |
| `texture(key): Texture \| undefined` | The texture of a loaded key; touches the use counter of its bundle. A key of a bundle that is not loaded: `undefined`, one dev warning naming key and bundle, and a background `load` of that bundle. Headless: `undefined`. |
| `font(key): { fnt, texture } \| undefined` | The `.fnt` file as text and the texture of its first page; touches the use counter. `text` installs it with `renderer.sync.fonts.install`. A bundle that is not loaded, another kind and headless: `undefined`, silently — no warning and no background load. |
| `audio(key): { bytes, mime } \| undefined` | A loaded sound: its bytes, undecoded, and the MIME type of its container, `"audio/mpeg"` for an `.mp3` and `"audio/mp4"` for an `.m4a`. `audio` decodes the bytes once, or streams them from a `blob:` URL built with `mime`, and drops them when `assets:bundle-unloaded` names the key. Same silent miss as `font`. |
| `usage(): { textureMb, budgetMb, bundles }` | Loaded bundles only, sorted by name. `lastUsed` is the use counter, never a clock. |

```ts
const assets = ctx.require(assetsPlugin);

await assets.load("board");
assets.texture("board.cell"); // the Pixi texture
assets.usage(); // { textureMb: 3.5, budgetMb: 192, bundles: [{ name: "board", ... }] }
```

`load` has no `signal` parameter. Internal callers — the enter callback, the `load` effect and the
preload queue — call `loadBundle(ctx, bundle, signal, reason)` of `tiers.ts` directly.

## Authoring helpers

Both are pure and exported from the package root; `defineGame` returns them typed by the game's
`BundleKey`, so a name the scanner never saw does not compile.

```ts
// features/board/assets.ts
export const boardAssets = defineBundles({
  board: { tier: "scene" },
  "board.chains": { tier: "lazy", files: ["chains/*.png"] }
});

// a loading node
await fx(load("board.chains")); // { loaded: ["board.chains"], mb: 1.25 }
```

| Rule | Detail |
|---|---|
| Default | A feature without `assets.ts` has one bundle, named as the feature, tier `"feature"`, all files of `assets/`. |
| Names | A bundle name is the feature name, or starts with `feature.`. Anything else is a scanner error. |
| `files` | A bundle with `files` takes the matching files out of the feature's default bundle. A file matched by two bundles is a scanner error naming both bundles. |

## Configuration

| Key | Type | Default | Meaning |
|---|---|---|---|
| `manifest` | `string \| Manifest \| undefined` | `undefined` | URL of `manifest.json`, or the parsed manifest itself (tests, headless). `undefined`: an empty manifest. |
| `textureBudgetMb` | `number` | `192` | Texture memory budget in MB. |
| `preloadDepth` | `number` | `2` | How many edges from a rest node the background preload looks ahead. `0` turns preload off. |
| `baseUrl` | `string \| undefined` | `undefined` | Prefix of every file URL — the CDN seam. `undefined`: the folder of the manifest URL, or `"/"` for an inline manifest. |
| `io` | `AssetsIo \| undefined` | `undefined` | The I/O seam. `undefined`: `browser.ts` plus `renderer.sync.textures` when `renderer.host.ready()`, otherwise headless. Tests pass a fake. |

```ts
createApp({
  plugins: [...screen, boardFeature],
  pluginConfigs: { assets: { manifest: "/assets/manifest.json", textureBudgetMb: 192 } }
});
```

`AssetsIo` is `fetch(url, { signal })`, `decode(blob)`, `createTexture(image, options?)`,
`sliceTexture(page, frame, options?)` and `destroyTexture(texture)` — the same test seam as
`clock.source`. A fake `sliceTexture` returns a counted `{ id, page, frame }`. The response it answers with
carries the four readers this plugin uses: `json()` for the manifest, `blob()` for an image,
`text()` for a `.fnt` file and `arrayBuffer()` for a sound, plus `headers.get(name)` for the
`content-type`. A real `Response` fits it as it is. A fake answers `headers: { get: () => null }`.

### A missing file on `tauri://`

The Tauri protocol answers a missing file with `200`, `content-type: text/html` and the body of
`index.html`. So a response counts as missing when it is not `ok`, or when its `content-type`
starts with `text/html` and the path does not end in `.html`. It fails with the same error as a
`404`: `(200, text/html)` instead of `(404)`. Nothing else reads the type. Decoding goes by the
extension, so a `.ktx2` served as `application/octet-stream` loads as before.

## The manifest

The dev manifest of `bun run assets:keys` is version 1: loose files, straight from the features.

```json
{
  "version": 1,
  "bundles": {
    "ui": {
      "feature": "ui", "tier": "core", "mb": 0.188,
      "files": [
        { "key": "ui.panel", "path": "features/ui/assets/panel{nine=48}.png",
          "width": 256, "height": 128, "mb": 0.125,
          "nine": { "left": 48, "top": 48, "right": 48, "bottom": 48 } }
      ]
    }
  }
}
```

| Field | Rule |
|---|---|
| `version` | `1` (the scanner) or `2` (the packer, below). Any other value is refused: `[game] assets: manifest version 3 is not supported (expected 1 or 2).` |
| `path` | POSIX, relative to the scan root. The URL is `baseUrl` + `path`. Absent on a texture packed in an atlas. |
| `kind` | `"font"` or `"audio"`. A file without a `kind` is a texture, so a manifest written before fonts and audio reads the same. |
| `pages` | A font only: the page images of its `.fnt`, in declaration order, each with `path`, `width`, `height` and `mb`. A page has no key: it belongs to the font. |
| `mb` | Estimated memory: `width × height × 4 / 1 048 576` for a texture, the sum of the pages for a font, the file size for audio. Rounded to 3 decimals; the bundle `mb` is the sum. No mipmaps. |
| `nine` | Optional, always four numbers, whichever of the three tag forms wrote them. Passed to `createTexture` as the tuple `[left, top, right, bottom]`. |
| `atlas` | `{ page, x, y, width, height }`: the file is cut out of the page of its bundle with that id. Written by the packer. |
| Order | Bundles sorted by name, files sorted by key. Unknown fields are ignored. |

## Manifest v2

`bun run assets:pack` writes version 2. The runtime reads both versions through one path: a file
with `atlas` is sliced from its page, a file with `path` is fetched. A v1 manifest still loads as
it is.

```json
{
  "version": 2,
  "bundles": {
    "ui": {
      "feature": "ui", "tier": "core", "mb": 8.865,
      "pages": [
        { "id": "ui/fx-0", "path": "ui/fx-0-2a7f9c04e1.webp", "width": 595, "height": 516, "mb": 1.171 },
        { "id": "ui/main-0", "path": "ui/main-0-3b1d55a0c9.webp", "width": 966, "height": 1365, "mb": 5.03 }
      ],
      "files": [
        { "key": "ui.bg-splash", "path": "ui/ui.bg-splash-5e0a71bd42.webp", "width": 1024, "height": 1536, "mb": 6 },
        { "key": "ui.click", "path": "ui/ui.click-9c4e2b7a10.mp3", "kind": "audio", "mb": 0.012 },
        { "key": "ui.font-body", "path": "ui/ui.font-body-7d2c90f1ab.fnt", "kind": "font", "mb": 1,
          "pages": [{ "path": "ui/ui.font-body-0-c81f3e2d55.png", "width": 512, "height": 512, "mb": 1 }] },
        { "key": "ui.fx-sparkle", "width": 85, "height": 96, "mb": 0,
          "atlas": { "page": "ui/fx-0", "x": 2, "y": 2, "width": 85, "height": 96 } },
        { "key": "ui.panel", "width": 256, "height": 128, "mb": 0,
          "nine": { "left": 48, "top": 48, "right": 48, "bottom": 48 },
          "atlas": { "page": "ui/main-0", "x": 583, "y": 595, "width": 256, "height": 128 } }
      ]
    }
  }
}
```

| Field | Rule |
|---|---|
| `bundle.pages` | Optional, sorted by `id`: `{ id, path, width, height, mb }`. `id` is `<bundle>/<group>-<index>`; `path` follows the `path` rule of a file; `mb` is `width × height × 4 / 1 048 576`. |
| `file.path` | Present on a loose texture, a font and a sound; absent on a packed texture. |
| `file.atlas` | `{ page, x, y, width, height }`. `page` is a page id of the same bundle, never a file name. `width` and `height` equal the file's own, so `nine` stays valid as it is. |
| `file.mb` | `0` for a packed texture: its page carries the cost. |
| `bundle.mb` | Pages + loose textures + font pages + audio bytes. `usage()` reports it unchanged. |
| Order | Bundles by name, pages by id, files by key. Field order of a file: `key`, `path`, `kind`, `width`, `height`, `mb`, `pages`, `nine`, `atlas`. |

## Tiers and the boot sequence

| Tier | When it loads | Can it be unloaded |
|---|---|---|
| `boot` | awaited in `onStart` | no |
| `core` | started in `onStart`, not awaited | no |
| `scene` | with the scene the node names | yes |
| `feature` | with any node of the feature's flow | yes |
| `lazy` | only on request | yes |

`onStart` reads `assets`, `scenes` and `flows` from `flow.features.all()`, gets the manifest,
builds the key index, and warns once per bundle a feature declares that the manifest does not
carry, or whose tier disagrees with it. A manifest that cannot be read rejects `onStart` in a
browser; headless it is a warning and an empty manifest.

## Loading one bundle

One running load per bundle; every caller is a waiter. The `reason` of `assets:bundle-loaded` is
the reason of the caller that started the load — a later waiter changes nothing. A caller's
`signal` rejects only that caller with an `AbortError`; when the last waiter leaves, the shared
controller aborts the fetches and the record goes back to `idle`.

A file is loaded by what the manifest says it is: a texture is fetched, decoded and uploaded; a
font reads its `.fnt` as text and uploads every page it lists; an audio file is kept as the raw
`ArrayBuffer` with the MIME type its extension names (`.m4a` is `"audio/mp4"`, anything else
`"audio/mpeg"`) and is never decoded here. A packed sound keeps its extension, so it keeps its type.

A packed bundle starts one load per atlas page first (fetched and uploaded with no borders). A
packed file waits for its page and becomes `io.sliceTexture(page, atlas, { nine })`: nothing is
fetched twice in one load. A page id the bundle does not list fails the file with
`[game] assets: file "ui.icon-coin" of bundle "ui" names page "ui/main-9", which the bundle does
not list.\n  Run "bun run assets:pack".`; a page that fails rejects every file on it with the
usual message, naming the page path and the status. A file with neither `path` nor `atlas` fails
with a message naming its key.

Every file that settles, loaded or failed, sends `assets:bundle-progress` with `loaded` (the
settled files so far) and `total` (the files of the bundle). A font counts once, when its `.fnt`
and all its pages are there. A page is not a file: the files of one page settle together, when
their slices exist. The last one of a load has `loaded === total`, and
`assets:bundle-loaded` comes after it. The files of an aborted load send nothing, so a loading bar
never moves for a load that will not finish.

On success the assets are stored, `renderer.sync.textures.invalidate` is called with the keys of
the bundle, the event goes out, `time.wake()` lifts the idle frame cap — the picture changes now —
and the budget is enforced. On failure every texture made so far is
destroyed (slices and loose textures first, then the pages, then the font pages, as on unload), the record goes back to `idle`, `ctx.log.error("assets: bundle failed", { bundle, file,
status, contentType })` is written and every waiter rejects with
`[game] assets: bundle "board" failed at "features/board/assets/cell.png" (404).` When the
response had a `content-type`, it follows the status: `(200, text/html)`. An abort is not
a failure and is never logged.

## Preload and budget

The `flow:rest` hook enforces the budget and rebuilds the background queue. The walk is
breadth-first over `flow.describe()` from the current node, at most `preloadDepth` edges:
`"node"` and `"map:node"` move inside the flow, a node with `subFlow` adds the start node of that
flow at the same distance, a node with `slot` adds the start nodes of `graph.slots[slot]`, and
`"exit:name"` continues on the parent frame taken from `flow.state().stack`. Bundles come out
ordered by distance, then by name; the `lazy` tier, what is loaded and what is loading outside
the running queue are skipped. The queue stops at the first bundle that would break the budget —
preload never evicts. A rest node with the same neighbourhood keeps the running queue, so a node
the graph comes back to often (a splash that commits its progress through a transit node) does
not restart its loads. A different neighbourhood replaces the queue and aborts the old one. A
fast walk skips the preload.

`enforceBudget` runs after every load and at every rest node: while `usedMb > textureBudgetMb` it
unloads the bundle with the smallest use counter that is not pinned, not `boot` or `core`, not
loading and not in the queue, with reason `"budget"`. When nothing may go it writes one warning
naming the five heaviest loaded entries, loose files and atlas pages together (a page row reads
`page "ui/main-0"` with its `mb`) — the cure is smaller art or a split bundle.

## Events

| Event | Payload |
|---|---|
| `assets:bundle-progress` | `{ bundle, loaded, total }` |
| `assets:bundle-loaded` | `{ bundle, tier, mb, reason: "boot" \| "enter" \| "request" \| "preload" }` |
| `assets:bundle-unloaded` | `{ bundle, tier, mb, reason: "budget" \| "request", keys }` |

`assets:bundle-progress` is for the game: no engine plugin listens to it. A splash screen fills
its loading bar from it.

```ts
createPlugin("loadingBar", {
  depends: [assetsPlugin],
  createState: () => ({ share: 0 }),
  hooks: ctx => ({
    "assets:bundle-progress": ({ loaded, total }) => {
      ctx.state.share = loaded / total; // 0.25, 0.5, 0.75, 1 for a bundle of four files
    }
  })
});
```

`keys` names every asset the bundle carried, so `text` drops the fonts it installed and `audio`
drops the buffers it decoded, per key.

`onStop` emits nothing: a teardown context has no `emit`.

## Headless

No `io` and a renderer that does not draw: the manifest is read and nothing else. `load` resolves
at once, `isLoaded` is `true` for every bundle of the manifest, `texture` is `undefined`, the
`load` effect resolves `{ loaded: [], mb: 0 }`, and there is no preload, no event and no budget
work.

## Files

| File | What |
|---|---|
| `index.ts` | The `createPlugin` call and the default config. |
| `types.ts` | Config, State, Events, `Api`, `AssetsIo`, the manifest types and the authoring types. |
| `state.ts` | `createAssetsState`. |
| `api.ts` | `createAssetsApi`, `lookupTexture` (the function the texture provider stands on) and the silent lookups behind `font` and `audio`. |
| `handlers.ts` | The `flow:rest` hook. |
| `lifecycle.ts` | `connectAssets` (onInit), `startAssets` (onStart), `releaseAll` (onStop), the enter callback and the `load` effect. |
| `bundles.ts` | `defineBundles` and the `load` descriptor. |
| `manifest.ts` | `parseManifest` (versions 1 and 2), `indexKeys`, `kindOf`, `resolveBaseUrl`, `fileUrl`, `nineOf`. |
| `tiers.ts` | `loadBundle`, `bootTiers`, `isPermanent`. |
| `preload.ts` | `bundlesOfNode`, `neighbourhood`, the background queue. |
| `budget.ts` | `usedMb`, `pickVictim`, `enforceBudget`, `unloadBundle`, `releaseAssets` (slices, then pages, then font pages). |
| `inspect.ts` | The `game.assets` source of the `/inspect` door. |
| `browser.ts` | The default io: the global `fetch`, `createImageBitmap`, `renderer.sync.textures` (`create`, `slice`, `destroy`). |
| `scan/` | Build time only, reachable through `@moku-labs/game/assets`: the walk, the key rule, the image and font readers, the two emitters and the CLI. |
| `scan/pack/` | Build time only: the production packer behind `--pack` (`pack`, `groups`, `layout`, `encode`, `names`, `cache`, `copy`). The only place that imports `sharp` and `maxrects-packer` (lint rule L11). |

## What the scanner reads

| File | Becomes |
|---|---|
| `.png`, `.webp` | one texture per file |
| `.fnt` with its `.png` pages | one font: the key is the `.fnt`'s, the pages are listed under it and are never keys of their own |
| `.mp3`, `.m4a` | one sound, sized by its bytes. `.m4a` is AAC in an MP4 container |
| `.aac`, `.ogg`, `.opus`, `.wav`, `.flac`, `.ttf`, anything else | left out with a note. Only MP3 and AAC in MP4 decode on every target WebView (a raw ADTS `.aac` has no container), and text is drawn from bitmap fonts |

`click.mp3` next to `click.m4a` is one key from two files: the scan fails and names both.

A nine-slice texture carries its borders in the file name. The key drops the tag.

| Tag | Borders | Example | Key |
|---|---|---|---|
| `{nine=N}` | every side `N` | `panel{nine=48}.png` | `ui.panel` |
| `{nine=H,V}` | left and right `H`, top and bottom `V` | `bar{nine=24,12}.png` | `ui.bar` |
| `{nine=L,T,R,B}` | left, top, right, bottom: the order `textures.create` takes | `sign{nine=30,10,40,20}.webp` | `ui.sign` |

Left plus right and top plus bottom must stay below the sides of the image, or the scan fails.
A malformed tag (`{nine=4,5,6}`, `{nine}`) is not a problem: the key keeps the whole name,
`ui.panel{nine=4,5,6}`, and the scan adds one note for the file. An unknown tag
(`{atlas=ui}`) is still a problem, and so is a fraction (`{nine=12.5}`): its `.` cannot stay in a
key, so the scan fails with a message that names the malformed tag.

`generated/assets.ts` carries `AssetKey` over every kind, plus the narrower `FontKey` and
`AudioKey` next to it, so a text style takes only a font and a sound only an MP3 or an M4A.

## Production packing

Dev stays on the loose pipeline above. A production build packs the same scan and key list into
atlas pages with `--pack <dir>`:

```jsonc
// game package.json
"assets:keys": "moku-game-assets --root src --manifest public/assets/manifest.json --keys src/generated/assets.ts",
"assets:pack": "moku-game-assets --root src --keys src/generated/assets.ts --pack dist/assets"
```

| Flag | Rule |
|---|---|
| `--pack <dir>` | Packs on the same scan and key list. `<dir>` belongs to the command: it is created, written and pruned. A folder that holds the game sources is refused. |
| `--manifest <file>` | With `--pack`: where the packed manifest goes, `<dir>/manifest.json` by default. The dev manifest is not touched by a pack run. |
| `--keys <file>` | Written as in a dev run, same bytes: keys do not change between the two modes. The strings compile runs as in a dev run. |
| `--no-cache` | Skips the cache, reads and writes. |
| `--check` | Refused with `--pack`: `[game] assets: "--pack" writes files; drop "--check".` Exit 1. |

`sharp` is an optional peer dependency: a game that packs runs `bun add -d sharp`; without it the
pack stops with `[game] assets: "--pack" needs sharp.\n  Run "bun add -d sharp".`

| Rule | Value |
|---|---|
| Page | 2048 × 2048 at most, as small as its content (not a power of two, not square). |
| Padding | 2 px between frames and a 2 px border, transparent, no extrude. |
| Trim, rotation | Never: a rotated or trimmed nine-slice would lose its borders. |
| Loose by size | A texture with a side above 512 px stays a file of its own. |
| Groups | Per bundle: `fx` holds the textures whose key's last segment starts with `fx-`, whatever their size (a particle emitter binds one page); `main` holds the other textures. |
| Group of one | Stays loose: an atlas of one file is one request either way. |
| `fx` pages | Exactly one; more is a problem naming the bundle and the count. |
| Oversized | A texture that fits no page is a problem naming the key, never a silent drop. |
| Pages | WebP, `quality: 80, alphaQuality: 80`, composed from the sources decoded to RGBA. |
| Loose textures | A `.webp` source is copied byte for byte; a `.png` source is encoded to WebP q80. |
| Fonts | The pages are copied byte for byte and stay PNG (MSDF needs lossless); the `.fnt` is rewritten to name the hashed pages, then hashed. |
| Audio | Copied byte for byte, with the extension of its source. |
| Hash | The first 10 hex characters of the SHA-256 of the written bytes, in every file name. |
| Prune | After writing, every file under `<dir>` the manifest does not reference, except `manifest.json`, is deleted. |
| Determinism | Inputs sorted by key, fixed packer options, `maxrects-packer` pinned: two runs on the same tree and the same `sharp` write the same bytes. |

Before anything is written, the pack checks that every key of the scan landed exactly once (a page
frame or a loose file), that every `atlas.page` names a page of its own bundle, that every frame
lies inside its page and has the size of its source (so `nine` stays valid). Every problem goes
into one error, then `Fix them and run "bun run assets:pack" again.`, exit 1.

The output folder:

```
dist/assets/
  manifest.json                         # version 2
  ui/fx-0-2a7f9c04e1.webp               # page <bundle>/<group>-<index>-<hash>.webp
  ui/main-0-3b1d55a0c9.webp
  ui/ui.bg-splash-5e0a71bd42.webp       # loose <bundle>/<key>-<hash>.webp
  ui/ui.font-body-7d2c90f1ab.fnt        # font <bundle>/<key>-<hash>.fnt
  ui/ui.font-body-0-c81f3e2d55.png      #   its pages <bundle>/<key>-<n>-<hash>.png
  ui/ui.click-9c4e2b7a10.mp3            # audio <bundle>/<key>-<hash>.mp3, or .m4a for an .m4a
```

The cache lives in `node_modules/.cache/moku-game-pack/` under the working directory: one entry
per atlas group and per encoded loose PNG, keyed by the versions of `sharp` and `maxrects-packer`,
the packing constants and the members (key, SHA-256 of the source, nine). A hit replays the frames
and the bytes with no decode and no encode; a changed source repacks only its group. Copies are not
cached. The cache is content-addressed and never pruned.

The command prints one line per bundle and a closing line through the branded console:

```
› packed ui: 2 pages, 0 loose, 2 fonts, 4 sounds, 8.814 MB
› wrote "dist/assets/manifest.json": 3 pages, 8 loose files, 2 fonts, 7 sounds, 2398 KB. cache: 3 of 3 pages.
```

`packAssets({ root, manifest, out, manifestFile, cache })` is the same packer as a function on the
door, for the editor and for tests: it takes the manifest of `scanAssets` and resolves
`{ manifest, pages, loose, bytes, cacheHits }`.

## Strings from the command line

The same command runs the string tools of i18n. The shape of the string files and of the exchange
files is in the i18n README, sections "Pseudo-locale" and "Export and import".

```jsonc
// game package.json
"assets:keys": "bun node_modules/@moku-labs/game/dist/assets.mjs --root src --manifest public/assets/manifest.json --keys src/generated/assets.ts --pseudo",
"assets:export": "bun node_modules/@moku-labs/game/dist/assets.mjs --root src --export translations",
"assets:import": "bun node_modules/@moku-labs/game/dist/assets.mjs --root src --keys src/generated/assets.ts --import translations"
```

| Flag | Rule |
|---|---|
| `--pseudo` | Dev run and `--check` only. The compile writes `generated/strings.en-XA.ts` too, and `--check --pseudo` checks it. With `--pack`: `[game] assets: "--pseudo" is for a dev run; drop it from "--pack".` Exit 1. |
| `--export <dir>` | Writes `<dir>/<locale>.json` for every locale, and nothing else: no asset scan, no generated module. `<dir>` is resolved against the working directory and created. One line per locale: `exported "<dir>/ru.json": 3 missing.` |
| `--import <dir>` | Writes the translated texts of `<dir>/*.json` into the string files of the features, then compiles into the folder of `--keys` (`<root>/generated` by default). One line for the whole run: `imported "<dir>" (ru): 3 keys into 2 files.` A problem is one error, exit 1. |
| `--source <locale>` | The locale translators read from, `"en"` by default. Only with `--export` or `--import`; elsewhere `[game] assets: "--source" goes with "--export" or "--import".` |

`--export` and `--import` run alone. With each other, with `--check` or with `--pack` the run stops
with `[game] assets: "--export" and "--import" run alone; drop the other flags.` `--pseudo` may join
`--import` (the compile after the import writes `en-XA` too); with `--export` it gets the same
refusal.

`runCli(argv, { compile, exportStrings, importStrings })` takes the three tools as a parameter:
i18n sits above assets, so the door `src/assets.ts` hands over `compileStrings`, `exportStrings`
and `importStrings`, and `scan/cli.ts` imports nothing from `i18n/`.

## Doors

`inspect.ts` holds `game.assets` (key `assets` in `sources`) of the editor's read door,
`@moku-labs/game/inspect`, safe in a production build. No input. It reads `usage()` and is read
again every frame (`changes: "frame"`), because a bundle loads without a model commit.

## Dependencies

- `flowPlugin` — `onEnter("load")`, `fx.handle("load", …, { runInFast: true })`, `features.all()`,
  `describe()`, `state()`.
- `rendererPlugin` — `sync.textures.provide / create / slice / destroy / invalidate`, `host.ready()`.
- `timePlugin` — `wake()` when a load settles, so the idle frame cap lifts as the picture changes.
