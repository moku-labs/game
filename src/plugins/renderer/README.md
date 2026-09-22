# renderer

> Very Complex plugin — pixels. One Pixi v8 application on one canvas. Game code never touches
> Pixi: it writes components, and this plugin owns every display object.

Three modules do the work and the plugin root composes them, in the injection order
`host → viewport → sync`: `host` creates the application and survives a lost device and a hidden
tab; `viewport` maps the window to the reference space whose short side is `referenceSide`; `sync`
is the ONE system that builds display objects from components, puts them in the named layers that
`world.projection.layers()` lists, pools them, labels them and answers hit tests.

```ts
app.renderer.host.canvas();                      // host
app.renderer.viewport.toReference(960, 540);     // viewport
app.renderer.sync.hitTest(540, 300, isLive);     // sync
```

No module imports a sibling's run-time code: `api.ts` injects `host` into `viewport`, and both into
`sync`. No file imports `pixi.js` as a value; the module object arrives from `config.loadPixi()`
and lives in `state.host.pixi`, so a game without `...screen` carries no Pixi in its bundle.

## Components

Pure, made with the `component()` helper of `world`, exported from the package root.

| Component | Defaults | Meaning |
|---|---|---|
| `Transform({ x, y, rotation, scale })` | `0, 0, 0, 1` | Reference units, radians, uniform scale. Relative to the `Parent` when there is one. |
| `Sprite({ texture, tint, alpha, anchor })` | `"", 0xffffff, 1, { x: 0.5, y: 0.5 }` | `texture` is an asset key. |
| `NineSlice({ texture, width, height })` | `"", 0, 0` | Size in reference units; the borders come with the texture. |
| `Parent({ entity })` | `0` | "Moves with its parent". It never decides draw order between layers. |
| `Display({ object })` | `undefined` | The game owns a Pixi object. Never pooled, never destroyed by `sync`. |

```ts
sprite({ texture: "board.cell", at: { x: 540, y: 300 } });
// [Sprite({ texture: "board.cell", tint: 0xffffff, alpha: 1, anchor: { x: 0.5, y: 0.5 } }),
//  Transform({ x: 540, y: 300, rotation: 0, scale: 1 })]
```

An entity has one visual: `Sprite`, `NineSlice` or `Display`. Two on one entity: the first in that
order wins and `ctx.log.warn` names the entity. `Layer`, `Order` and `Exiting` belong to `world`.

## API

### `host` — `app.renderer.host`

| Method | Behaviour |
|---|---|
| `ready(): boolean` | True after a successful init. False while inert, while the device is lost and on the unsupported screen. |
| `kind(): "webgpu" \| "webgl" \| "none"` | The backend Pixi chose, read once after init. `"none"` while inert or unsupported. |
| `canvas(): HTMLCanvasElement \| undefined` | A WebGPU restore makes a NEW canvas: a caller that holds listeners compares it with its own every frame. |

### `viewport` — `app.renderer.viewport`

| Method | Behaviour |
|---|---|
| `toReference(clientX, clientY)` | `(client − canvas rect − frame offset) / scale`. The rectangle is read at call time. Inert: the input unchanged. |
| `size()` | Reference units, a fresh object. The short side is always `referenceSide`. Inert: the `aspect.min` frame, `scale: 1`, zero safe area. |

### `sync` — `app.renderer.sync`

| Method | Behaviour |
|---|---|
| `hitTest(x, y, accept)` | Reference coordinates, topmost first. Component math, never a Pixi world matrix. Inert: `undefined`. |
| `textures.provide(fn)` | Adds a provider to the chain; the newest is asked first. Returns the remover. Works while inert. |
| `textures.create(image, { nine? })` | Makes a Pixi texture, so `assets` never imports Pixi. `nine` is left, top, right, bottom in pixels. Throws while the renderer does not draw. |
| `textures.destroy(texture)` | `texture.destroy(true)`. Twice is a no-op. |
| `textures.invalidate(keys)` | Every view with one of these keys resolves again in the next pass; the pooled objects of these keys are destroyed at once. No-op while inert. |
| `displayOf(entity)` | The Pixi object of the entity, for debugging. |

There is no `sync.layers`: layers are declared by the scene, through `world.projection.setLayers`.

## Configuration

| Key | Type | Default | Meaning |
|---|---|---|---|
| `mount` | `string \| HTMLElement \| undefined` | `undefined` | Where the canvas goes. `undefined` keeps the plugin inert. |
| `background` | `number` | `0x000000` | Clear colour, and the colour of the bars around the frame. |
| `antialias` | `boolean` | `false` | Antialias the whole canvas. |
| `maxResolution` | `number` | `2` | Cap of `devicePixelRatio`. Memory grows with its square. |
| `preference` | `"webgpu" \| "webgl"` | `"webgpu"` | Passed to Pixi. Pixi falls back to WebGL by itself. |
| `aspect` | `{ min, max }` | `{ 4 / 3, 21 / 9 }` | Allowed long side / short side. A window outside it gets bars. |
| `poolLimit` | `number` | `256` | Display objects kept in all pools together. |
| `unsupportedMessage` | `string` | `"This device cannot run the game."` | Text of the unsupported-device screen. |
| `loadPixi` | `() => Promise<PixiModule>` | `() => import("pixi.js")` | Loader seam. Tests pass a fake module. |

```ts
const app = createApp({
  plugins: [...screen, boardFeature],
  pluginConfigs: { renderer: { mount: "#game", background: 0x101018 } }
});
```

`orientation` and `referenceSide` are read from the framework config, not from here.

## The frame

| `time` phase | What `renderer` does |
|---|---|
| `sync` | The `renderer.sync` system runs one pass: removed views, layers, added views, changed components, invalidated texture keys. |
| `render` | A pending resize is applied, then `app.renderer.render(app.stage)` when `ready`. |

Pixi's own ticker never starts: `time` owns the one loop. The pass touches only what changed, and a
throw costs one entity, not the frame: it is reported with `ctx.log.error` and the label of the view.

## Layers, sort and lift

`scenes` calls `world.projection.setLayers(list)`. Every pass compares `world.projection.layers()`
with the list it last saw, by reference. A new reference rebuilds: one `Container` per entry under
the root, label `layer:items`, children of the root in list order, first is the bottom. A name that
stays keeps its container and its views.

| Sort | `zIndex` of a child | Resort happens |
|---|---|---|
| `"none"` | not used; `sortableChildren = false` | never |
| `"y"` | `Transform.y` | only when a member's `y` changed, or a member joined |
| `"order"` | `Order.value` (0 without `Order`) | only when `Order` changed, or a member joined |

`zIndex` is written only when the number differs, and Pixi's sort is stable, so ties keep insertion
order. A lift changes `Layer`; `sync` moves the SAME display object, with no pool round trip and no
jump, because `Transform` is in reference space on every layer. The first time an entity is named as
a parent it gets a wrapper `Container` (a v8 sprite takes no children); its own visual becomes child
0 and the transform moves to the wrapper.

## Textures

`resolve(key)` asks the providers from the newest to the oldest; the first non-`undefined` wins.
Nothing answers: the view draws `Texture.WHITE` at 64×64 with tint `0xff00ff`, and `ctx.log.warn`
reports the key once. The key is not asked again per frame — only `invalidate(keys)` makes it
resolve again. `assets` owns texture lifetime: it calls `create`, answers through its provider, and
calls `invalidate` then `destroy` on unload. The renderer never destroys a texture by itself.

## Device loss and the hidden tab

| Step | WebGPU | WebGL |
|---|---|---|
| Detect | the `renderer.gpu.device.lost` promise | the canvas event `webglcontextlost`, with `preventDefault()` |
| On loss | `ready` false → `lifecycle.push("device-lost")` → `renderer:device-lost` | the same |
| Restore | destroy the application, init again, new canvas, then `viewport.apply` and `sync.rebuildAll()` | Pixi restores on `webglcontextrestored` |
| After | `ready` true → `lifecycle.pop("device-lost")` | the same |
| Restore fails | the unsupported-device screen; the pause reason stays | the same |

A hidden tab is `lifecycle.push("background")`, a visible one `pop`. Textures are not reloaded by
the renderer: a texture source keeps its CPU image and Pixi uploads it again.

## Events

| Event | Payload | When |
|---|---|---|
| `renderer:device-lost` | `{ kind, reason }` | The GPU device or the WebGL context went away. Rare; the restore is visible as `lifecycle:changed` with `reason: "device-lost"`, `action: "pop"`. |

## Lifecycle

- **onStart** `startRenderer` resolves the mount, loads Pixi, creates the application and appends
  the canvas; then, in the `onReady` callback, `viewport` creates the safe-area probe and the
  resize observer, `sync` creates the root, the world hooks and the `renderer.sync` system, and the
  `render` frame callback is registered. Inert without a document or without a mount: nothing is
  created and nothing is registered.
- **onStop** `({ config, state }) => stopRenderer({ config, state })` runs the cleanups of `sync`,
  `viewport` and `host` in that order, destroys the pooled objects and the application
  (`{ removeView: true }`, `{ children: true, texture: false }`), removes the probe and the
  unsupported element and clears every map. It runs before `world` stops, so the world hooks are
  removed while `world` is alive. Textures are left to `assets`; a `Display` object is detached,
  never destroyed.

## Dependencies

`time` for `onFrame("render")`, `lifecycle` for `push`/`pop` of `"background"` and `"device-lost"`,
`world` for `ecs.system`, `ecs.onAdded`/`onRemoved`/`changed`/`get`/`query` and
`projection.layers`/`keyOf`. Core APIs: `ctx.log`. `pixi.js` is a peer dependency, reached only
through `config.loadPixi`.

## What the unit tests cannot see

The tests run in plain Bun against a fake Pixi module and a fake DOM, so these belong to the e2e
station in a real browser: that `kind()` is `webgpu` in Chrome and `webgl` with
`preference: "webgl"`, that the board is visible and sorted on a screenshot, a real resize and a
device rotation, the safe area on a mobile profile, a real device loss through `device.destroy()`
and `WEBGL_lose_context`, a really hidden tab, the labels in the Pixi DevTools tree, and that the
bundle of a game without `...screen` carries no Pixi import.
