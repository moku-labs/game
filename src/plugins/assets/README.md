# assets

> Complex plugin — the art of the game: bundles of textures by key, a graph-driven preload and a texture-memory budget.

The plugin knows which image files a game has (the manifest), loads them in bundles, hands textures
to `renderer` by key and keeps GPU memory under a budget. Bundles belong to features. Loading is
driven by the graph: the node being entered gets its bundles, the neighbourhood of a rest node is
preloaded in the background.

Nothing here imports `pixi.js`, not even dynamically. A texture is made by
`renderer.sync.textures.create` and freed by `renderer.sync.textures.destroy`; `types.ts` only uses
the texture *type*.

## API

| Method | Behaviour |
|---|---|
| `load(bundle): Promise<void>` | Loads every file of the bundle. Already loaded: resolves at once. Loading: joins the running load. Unknown bundle: rejects with `[game] assets: no bundle "bord" in the manifest.\n  Run "bun run assets:keys".` Headless: resolves at once, state untouched. |
| `unload(bundle): void` | Destroys the textures through `io.destroyTexture`, calls `renderer.sync.textures.invalidate` with the keys of the bundle, emits `assets:bundle-unloaded` with reason `"request"`. A pinned bundle and the tiers `boot` and `core` are refused with a `ctx.log.warn`. A running load is aborted. |
| `isLoaded(bundle): boolean` | `status === "loaded"`. Headless: `true` for every bundle of the manifest. |
| `texture(key): Texture \| undefined` | The texture of a loaded key; touches the use counter of its bundle. A key of a bundle that is not loaded: `undefined`, one dev warning naming key and bundle, and a background `load` of that bundle. Headless: `undefined`. |
| `font(key): { fnt, texture } \| undefined` | The `.fnt` file as text and the texture of its first page; touches the use counter. `text` installs it with `renderer.sync.fonts.install`. A bundle that is not loaded, another kind and headless: `undefined`, silently — no warning and no background load. |
| `audio(key): ArrayBuffer \| undefined` | The bytes of a loaded `.mp3`, undecoded: `audio` decodes them once and drops them when `assets:bundle-unloaded` names the key. Same silent miss as `font`. |
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

`AssetsIo` is `fetch(url, { signal })`, `decode(blob)`, `createTexture(image, options?)` and
`destroyTexture(texture)` — the same test seam as `clock.source`. The response it answers with
carries the four readers this plugin uses: `json()` for the manifest, `blob()` for an image,
`text()` for a `.fnt` file and `arrayBuffer()` for a sound. A real `Response` fits it as it is.

## The manifest

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
| `version` | `1`. Any other value is refused: `[game] assets: manifest version 2 is not supported (expected 1).` |
| `path` | POSIX, relative to the scan root. The URL is `baseUrl` + `path`. |
| `kind` | `"font"` or `"audio"`. A file without a `kind` is a texture, so a manifest written before fonts and audio reads the same. |
| `pages` | A font only: the page images of its `.fnt`, in declaration order, each with `path`, `width`, `height` and `mb`. A page has no key: it belongs to the font. |
| `mb` | Estimated memory: `width × height × 4 / 1 048 576` for a texture, the sum of the pages for a font, the file size for audio. Rounded to 3 decimals; the bundle `mb` is the sum. No mipmaps. |
| `nine` | Optional, always four numbers, whichever of the three tag forms wrote them. Passed to `createTexture` as the tuple `[left, top, right, bottom]`. |
| `atlas` | Reserved. A file that carries it fails its bundle with a message naming the file. |
| Order | Bundles sorted by name, files sorted by key. Unknown fields are ignored. |

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
`ArrayBuffer` and is never decoded here.

Every file that settles, loaded or failed, sends `assets:bundle-progress` with `loaded` (the
settled files so far) and `total` (the files of the bundle). A font counts once, when its `.fnt`
and all its pages are there. The last one of a load has `loaded === total`, and
`assets:bundle-loaded` comes after it. The files of an aborted load send nothing, so a loading bar
never moves for a load that will not finish.

On success the assets are stored, `renderer.sync.textures.invalidate` is called with the keys of
the bundle, the event goes out, `time.wake()` lifts the idle frame cap — the picture changes now —
and the budget is enforced. On failure every texture made so far is
destroyed, the record goes back to `idle`, `ctx.log.error("assets: bundle failed", { bundle, file,
status })` is written and every waiter rejects with
`[game] assets: bundle "board" failed at "features/board/assets/cell.png" (404).` An abort is not
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
naming the five heaviest loaded files — the cure is smaller art or a split bundle.

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
| `manifest.ts` | `parseManifest`, `indexKeys`, `kindOf`, `resolveBaseUrl`, `fileUrl`, `nineOf`, `atlasProblem`. |
| `tiers.ts` | `loadBundle`, `bootTiers`, `isPermanent`. |
| `preload.ts` | `bundlesOfNode`, `neighbourhood`, the background queue. |
| `budget.ts` | `usedMb`, `pickVictim`, `enforceBudget`, `unloadBundle`. |
| `inspect.ts` | The `game.assets` source of the `/inspect` door. |
| `browser.ts` | The default io: the global `fetch`, `createImageBitmap`, `renderer.sync.textures`. |
| `scan/` | Build time only, reachable through `@moku-labs/game/assets`: the walk, the key rule, the image and font readers, the two emitters and the CLI. |

## What the scanner reads

| File | Becomes |
|---|---|
| `.png`, `.webp` | one texture per file |
| `.fnt` with its `.png` pages | one font: the key is the `.fnt`'s, the pages are listed under it and are never keys of their own |
| `.mp3` | one sound, sized by its bytes |
| `.ogg`, `.wav`, `.ttf`, anything else | left out with a note. One audio format decodes on every target WebView, and text is drawn from bitmap fonts |

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
`AudioKey` next to it, so a text style takes only a font and a sound only an MP3.

## Doors

`inspect.ts` holds `game.assets` (key `assets` in `sources`) of the editor's read door,
`@moku-labs/game/inspect`, safe in a production build. No input. It reads `usage()` and is read
again every frame (`changes: "frame"`), because a bundle loads without a model commit.

## Dependencies

- `flowPlugin` — `onEnter("load")`, `fx.handle("load", …, { runInFast: true })`, `features.all()`,
  `describe()`, `state()`.
- `rendererPlugin` — `sync.textures.provide / create / destroy / invalidate`, `host.ready()`.
- `timePlugin` — `wake()` when a load settles, so the idle frame cap lifts as the picture changes.
