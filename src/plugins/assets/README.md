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
`destroyTexture(texture)` — the same test seam as `clock.source`.

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
| `mb` | Estimated texture memory: `width × height × 4 / 1 048 576`, rounded to 3 decimals. The bundle `mb` is the sum. No mipmaps. |
| `nine` | Optional, always four numbers. Passed to `createTexture` as the tuple `[left, top, right, bottom]`. |
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

On success the textures are stored, `renderer.sync.textures.invalidate` is called with the keys of
the bundle, the event goes out and the budget is enforced. On failure every texture made so far is
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
ordered by distance, then by name; the `lazy` tier, what is loaded and what is loading are
skipped. The queue stops at the first bundle that would break the budget — preload never evicts.
A new rest node replaces the queue and aborts the old one. A fast walk skips the preload.

`enforceBudget` runs after every load and at every rest node: while `usedMb > textureBudgetMb` it
unloads the bundle with the smallest use counter that is not pinned, not `boot` or `core`, not
loading and not in the queue, with reason `"budget"`. When nothing may go it writes one warning
naming the five heaviest loaded files — the cure is smaller art or a split bundle.

## Events

| Event | Payload |
|---|---|
| `assets:bundle-loaded` | `{ bundle, tier, mb, reason: "boot" \| "enter" \| "request" \| "preload" }` |
| `assets:bundle-unloaded` | `{ bundle, tier, mb, reason: "budget" \| "request" }` |

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
| `api.ts` | `createAssetsApi` and `lookupTexture`, the function the texture provider stands on. |
| `handlers.ts` | The `flow:rest` hook. |
| `lifecycle.ts` | `connectAssets` (onInit), `startAssets` (onStart), `releaseAll` (onStop), the enter callback and the `load` effect. |
| `bundles.ts` | `defineBundles` and the `load` descriptor. |
| `manifest.ts` | `parseManifest`, `indexKeys`, `resolveBaseUrl`, `fileUrl`, `nineOf`, `atlasProblem`. |
| `tiers.ts` | `loadBundle`, `bootTiers`, `isPermanent`. |
| `preload.ts` | `bundlesOfNode`, `neighbourhood`, the background queue. |
| `budget.ts` | `usedMb`, `pickVictim`, `enforceBudget`, `unloadBundle`. |
| `browser.ts` | The default io: the global `fetch`, `createImageBitmap`, `renderer.sync.textures`. |

## Dependencies

- `flowPlugin` — `onEnter("load")`, `fx.handle("load", …, { runInFast: true })`, `features.all()`,
  `describe()`, `state()`.
- `rendererPlugin` — `sync.textures.provide / create / destroy / invalidate`, `host.ready()`.
