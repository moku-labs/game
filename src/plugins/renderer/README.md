# renderer

> Very Complex plugin — pixels. One Pixi v8 application on one canvas. Game code never touches
> Pixi: it writes components, and this plugin owns every display object.

Four modules do the work and the plugin root composes them, in the injection order
`host → viewport → sync → monitor`: `host` creates the application and survives a lost device and a hidden
tab; `viewport` maps the window to the reference space, fitting `referenceSide` across and
`referenceLong` along inside the safe area; `sync`
is the ONE system that builds display objects from components, puts them in the named layers that
`world.projection.layers()` lists, pools them, labels them and answers hit tests; `monitor` keeps
the frame counters and takes a picture of a frame for the editor.

```ts
app.renderer.host.canvas();                      // host
app.renderer.viewport.toReference(960, 540);     // viewport
app.renderer.sync.hitTest(540, 300, isLive);     // sync
app.renderer.stats();                            // monitor
```

No module imports a sibling's run-time code: `api.ts` injects `host` into `viewport`, both into
`sync`, and `host` and `sync` into `monitor`. `api.ts` also injects `installDrawCounting` of
`monitor/draw-calls.ts` into `host` in a dev build, already bound to the draw counter in
`state.monitor`, because `host/init.ts` must put the counter in Pixi's registry before
`new Application()`, before `monitor` exists. `host` never reads the monitor branch of the state. No file imports `pixi.js` as a value; the module object arrives from `config.loadPixi()`
and lives in `state.host.pixi`, so a game without `...screen` carries no Pixi in its bundle.

## Components

Pure, made with the `component()` helper of `world`, exported from the package root.

| Component | Defaults | Meaning |
|---|---|---|
| `Transform({ x, y, rotation, scale, pivot })` | `0, 0, 0, 1, { x: 0, y: 0 }` | Reference units, radians, uniform scale. Relative to the `Parent` when there is one. `pivot` is the local point the view turns and scales around; `x`, `y` is where it lands. |
| `Sprite({ texture, tint, alpha, anchor, width, height, fit })` | `"", 0xffffff, 1, { x: 0.5, y: 0.5 }, 0, 0, "fill"` | `texture` is an asset key. `width`/`height` are the box in reference units; 0 keeps the texture's own size on that axis. `fit` is `"fill"`, `"contain"` or `"cover"`. |
| `NineSlice({ texture, width, height, alpha, tint, debug, clip })` | `"", 0, 0, 1, 0xffffff, false, false` | Size in reference units; the borders come with the texture (`defaultBorders`, copied on every write, 0 when the texture has none). `debug: true` draws the slice outline over it. `clip: true` masks the children of the entity to the `width × height` box, as `Shape.clip` does: a filled rectangle in the wrapper, never drawn, redrawn on a size change. The panel itself is never masked. |
| `Parent({ entity })` | `0` | "Moves with its parent". It never decides draw order between layers. |
| `Display({ object })` | `undefined` | The game owns a Pixi object. Never pooled, never destroyed by `sync`. `effects` places its particle containers through it, on entities it owns. |
| `Shape({ kind, w, h, fill, fillAlpha, alpha, radius, stroke, strokeWidth, dash, clip })` | `"rect", 0, 0, 0xffffff, 1, 1, 0, 0x000000, 0, 0, false` | A filled rounded rectangle, or with `kind: "triangle"` a triangle that fills its `w × h` box pointing right (rotate the element for another direction; `radius` is ignored), drawn with `Graphics`, anchored top left. `fillAlpha` is the alpha of the fill alone: `0` draws only the stroke, a ring. `alpha` fades the whole shape. `dash` above 0 dashes the stroke: dashes of `dash` reference units, gaps of half a dash, walking the straight edges and the rounded corners sampled as arcs (`sync/shape-path.ts`). `clip: true` masks the children of the entity to the shape, never the shape itself, so its stroke is drawn whole; the mask is always filled and never dashed. Motions tween only the numeric fields, never `kind`. |

```ts
sprite({ texture: "board.cell", at: { x: 540, y: 300 } });
// [Sprite({ texture: "board.cell", tint: 0xffffff, alpha: 1, anchor: { x: 0.5, y: 0.5 },
//   width: 0, height: 0, fit: "fill" }),
//  Transform({ x: 540, y: 300, rotation: 0, scale: 1, pivot: { x: 0, y: 0 } })]
```

### Sprite size and fit

A sprite without a size is drawn at its texture's size. With a box, `fit` decides how the texture
fills it:

| `fit` | Drawn |
|---|---|
| `"fill"` | Stretched to the box on both axes. |
| `"contain"` | Scaled uniformly to fit inside the box, centred in it. |
| `"cover"` | Scaled uniformly to cover the box; the overflow is cropped through a sub-frame texture, never stretched. |

```ts
// A full-bleed background: the box is the screen, the anchor its top left corner.
Sprite({ texture: "board.bg-forest-meadow", anchor: { x: 0, y: 0 }, width: 1080, height: 1920, fit: "cover" });
```

`anchor` names a point of the box, and the hit box is the box, whatever part of it the picture
covers. The crop of a `"cover"` sprite is cached by texture key and box size and shared by every
sprite that shows it. It is freed when the last of them lets go (it leaves, or its key, box or
`fit` changes), with its base texture (`textures.destroy`), or when the renderer stops. A resized
cover sprite therefore keeps one crop, not one per size. A key without a texture draws the magenta
placeholder at the box, 64 x 64 on an axis without a size.

### Pivot

`pivot` is in the view's own local units. The renderer writes it on the Pixi container, so
`position` is where the pivot lands and rotation and scale turn around it. The default pivot keeps
every pose as it was. A parent's wrapper carries the pivot; the parent's own visual sits unmoved
inside it, and the children are placed in the wrapper's local space.

An entity has one visual: `Sprite`, `NineSlice`, `Shape`, `Display`, or a component a plugin above
registered with `displays.provide`. Two on one entity: the first in that order wins and
`ctx.log.warn` names the entity. A `Shape` is redrawn only when its value changed, never per frame.
`Layer`, `Order` and `Exiting` belong to `world`.

## API

### `host` — `app.renderer.host`

| Method | Behaviour |
|---|---|
| `ready(): boolean` | True after a successful init. False while inert, while the device is lost and on the unsupported screen. |
| `kind(): "webgpu" \| "webgl" \| "none"` | The backend Pixi chose, read once after init. `"none"` while inert or unsupported. |
| `canvas(): HTMLCanvasElement \| undefined` | A WebGPU restore makes a NEW canvas: a caller that holds listeners compares it with its own every frame. |
| `pixi(): PixiModule \| undefined` | The lazily loaded Pixi module once `ready()`, so a plugin above draws with the same Pixi and imports none of it. `undefined` while inert, lost or unsupported. |
| `device(): GPUDevice \| undefined` | The GPU device of the live WebGPU application, read at call time: a restore makes a new one. `effects` checks a custom filter's WGSL with it in a dev build. `undefined` while inert, before `ready()`, while lost, on the unsupported screen and on WebGL. |

### `viewport` — `app.renderer.viewport`

| Method | Behaviour |
|---|---|
| `toReference(clientX, clientY)` | `(client − canvas rect − frame offset) / scale`. The rectangle is read at call time. Inert: the input unchanged. |
| `toScreen({ x, y })` | The inverse: reference units to client CSS pixels, `canvas rect + frame offset + point × scale`. The `game.rect` source places an element on the page with it. Inert: the same numbers, a fresh object. |
| `size()` | Reference units, a fresh object. `scale = min(short / referenceSide, (long − safe insets) / referenceLong)`: the short side is at least `referenceSide` and grows on a wide screen, the long side inside the safe area is at least `referenceLong`. Inert: the `aspect.min` frame, `scale: 1`, zero safe area. |

### `sync` — `app.renderer.sync`

| Method | Behaviour |
|---|---|
| `hitTest(x, y, accept)` | Reference coordinates, topmost first. Component math, never a Pixi world matrix. Inert: `undefined`. |
| `textures.provide(fn)` | Adds a provider to the chain; the newest is asked first. Returns the remover. Works while inert. |
| `textures.create(image, { nine? })` | Makes a Pixi texture, so `assets` never imports Pixi. `nine` is left, top, right, bottom in pixels. Throws while the renderer does not draw. |
| `textures.slice(page, { x, y, width, height }, { nine? })` | Cuts a texture out of an atlas page for `assets`: a wrapper over the page's source, its frame in page pixels offset by the page's own frame, `nine` as in `create`. Throws while the renderer does not draw, and when the frame does not fit in the page. See "Slices of an atlas page". |
| `textures.destroy(texture)` | `texture.destroy(true)`; a slice `destroy(false)`, the wrapper only. The crops cut from it go too. Twice is a no-op. |
| `textures.invalidate(keys)` | Every view with one of these keys resolves again in the next pass; the pooled objects of these keys are destroyed at once. No-op while inert. |
| `displays.provide(Component, adapter)` | A plugin above says how its own component becomes a display object: `create` on the first pass after it appeared, `update` on every change, `destroy` when it leaves. Stored while inert, never called there. Returns the remover. |
| `fonts.install(key, fnt, texture)` | Installs a BMFont file (text, XML or JSON) and its page texture under an asset key. Throws while the renderer does not draw. |
| `fonts.installed(key)` | Whether that font key is installed in this application. |
| `displayOf(entity)` | The Pixi object of the entity, for debugging. |
| `debug.nineSlice(on)` | Outlines every nine-slice (next pass). A nine-slice with its own `debug: true` keeps its outline while the switch is off. Works while inert. |
| `debug.state()` | `{ nineSlice }`, a fresh object. |
| `filters.set(entity, slots)` | The filters drawn on the entity's view, in order: `slots` is `{ filter, passes }[]`, a Pixi filter instance `effects` built and the render passes one apply costs; `[]` clears. See "Filters". Works while inert: stored, nothing applied. |
| `renderPasses()` | The render passes of the frame, the number `stats().renderPasses` reports, read from the filter slots at call time with no allocation. `effects` reads it once per frame for its pass budget. See "Render passes". Inert: 0. |

There is no `sync.layers`: layers are declared by the scene, through `world.projection.setLayers`.
An adapter object is parented, sorted and freed like a sprite; its hit box is `getLocalBounds()`
read at attach, as a `Display` object's is. A point outside the rectangle of a `clip: true` ancestor
(a `Shape` or a `NineSlice`) hits nothing inside it. The hit test moves the point into the view's local space through the pose
helpers below, pivot included. A box without area holds no point: a particle container measures
`0 × 0` and is never hit, not even at its origin.

### Filters

`effects` builds, writes and destroys the filter instances; `sync` only hangs them on a view and
counts their passes. `set` keeps the list per entity, view or not, so a call made before the first
pass built the view lands when it is built. The Pixi target is `view.wrapper ?? view.object`: the
filters cover the entity's subtree, so a glow on a button glows its label too, and they move from
the object to a wrapper made later. Pixi copies and freezes the list on every assignment and
rebuilds the render group when a view goes from no filter to some, so `sync` writes only when the
instances differ from what the target holds; uniform writes and `enabled` flips need no call.

The filters come off the object and its wrapper when the view lets its object go: a pooled sprite
never carries one into its next life, and a `Display` object leaves without them, on despawn as at
stop. The entry is forgotten when the entity despawned, read with `ecs.ownerOf` in the pass where its
visual left, and when the renderer stops. Each pass also sweeps the entries of entities that have
no view and whose `ecs.ownerOf` is `undefined`, so an entity that despawned after its visual had
already left is forgotten too. A live entity keeps its filters for its next visual, in
the same frame (a `ui` element that trades its shape for a nine-slice keeps its glow) or later. A `rebuildAll` after a restore applies them again. The renderer never destroys a filter.

### `monitor` — `app.renderer.stats()`, `app.renderer.capture()`

| Method | Behaviour |
|---|---|
| `stats()` | `{ fps, frameMs, textures, textureMb, views, pooled, renderPasses }`, plus `drawCalls` in a dev build, a fresh object. Inert: all 0. |
| `capture()` | Dev builds only. A PNG data URL of the whole canvas, bars included, taken right after the next frame is drawn; at once while the clock is paused. `undefined` in a production build, while inert, lost or unsupported, and when Pixi cannot read the frame (logged). |

- `fps` counts frame starts over one second of `clock` time; 0 before the first full second and
  when no frame was drawn in the last second. A gap over one second, a pause or a hidden tab,
  restarts the window instead of reading as one slow frame.
- `frameMs` is the mean CPU work of a frame over the same second: from the renderer's callback in
  phase `input` to the end of `render`. The clock is the `clock` plugin's: lint L3 keeps the device
  clock out of the renderer. `clock.now()` is whole milliseconds, so one frame reads 3 or 4 ms and
  the mean over a second is exact enough.
- `textures` counts the live sources in Pixi's `renderer.texture.managedTextures`, on WebGPU and
  WebGL alike. Pixi 8.21 builds that list with `Object.values` of a `GCManagedHash`, which keeps a
  `null` slot for every unloaded source, so the `null` slots are skipped for the count and the bytes.
- `managedTextures` is deprecated since Pixi 8.15. Pixi 8.21 has no public replacement: the
  `GCSystem` keeps its resource hashes private.
  `textureMb` estimates their memory: 4 bytes per pixel (PNG and WebP decode to RGBA8), every mip
  level, in MiB.
- `views` and `pooled` are read from the `sync` state, `renderPasses` through `sync.renderPasses()`.
- The frame timing costs two `clock.now()` calls and a few number writes per frame; no allocation.
  The rest is read only when `stats()` is called.

#### Render passes

`renderPasses` is computed from the filter slots `sync` holds, never asked of the GPU, at call time:
0 while inert; otherwise `1 + Σ over views in the tree with an enabled filter (1 + Σ passes of the
enabled slots)`. A filtered view costs one pass for its content and one per filter apply (spike
P10); a disabled filter costs nothing, and a view whose filters are all disabled counts 0. A view
out of the tree (an unknown layer) counts 0. The pins from P10: no filter `1`; one glow of 1 pass
on a button `3`; one full-screen blur of quality 4 (8 applies) `10`; a glow and a tint on ten
buttons `31`. The renderer is the one owner of this number; `effects` declares the passes per kind
and reads `sync.renderPasses()` for its budget warnings: the same number, without the texture walk
and the fresh object of `stats()`.

#### Draw calls

`drawCalls` is counted in dev builds only, on WebGPU. Under WebGPU three Pixi 8.21 classes issue
every draw: `GpuBatchAdaptor.execute` (one `drawIndexed` per batch), `GpuGraphicsAdaptor.execute`
(one per instruction of the graphics context) and `GpuEncoderSystem.draw` / `drawIndirect` (meshes,
tiling sprites, particles, filters). `monitor/draw-calls.ts` builds counting subclasses of them from
the module object, each with the base's `static extension` object, and `host/init.ts` swaps them in
through `pixi.extensions.remove` and `add` after `loadPixi()` and before `new Application()`,
because Pixi builds its systems and adaptors inside `init`. No native prototype and no Pixi
instance is patched. The swap happens once per host state: a restore after a lost device reuses the
classes. `onStop` swaps Pixi's own classes back, so a second `createApp` on the page (HMR) starts
from them. A Pixi module without the three classes draws on uncounted, with `ctx.log.warn`.

The install sits behind the inline dev guard and logs `"moku:dev"` with
`{ command: "renderer.drawCalls" }`, so a production `define` folds it and the counter leaves the
bundle; `stats()` then has no `drawCalls` field. The guard is the one of `capture()` written as a
positive branch (`typeof __MOKU_GAME_DEV__ !== "undefined" && __MOKU_GAME_DEV__`): Bun 1.3.14 drops
code used only inside a folded `if`, but keeps code used after a folded early `return`. `api.ts`
hands `host` the counter under the same guard, so a production build drops the counter module. `begin()` starts the count of a frame at 0 and
`end()` closes it, so a draw between frames, as a capture's extract, is not counted. The WebGL
fallback reads 0: the three classes are WebGPU ones. Known miss: Pixi 8.22 adds one native
`pass.draw(3)` for the MSAA restore (`GpuMsaaRestore`), which no subclass sees; it costs one call
per frame only with `antialias: true`, whose default is false. The project pins 8.21.0, and a unit
test against the real module pins the three names, their `extension` metadata and their methods.

#### Capture

- `capture()` guards with `typeof __MOKU_GAME_DEV__ === "undefined" || !__MOKU_GAME_DEV__` inline,
  not with `isDev()`: Bun does not inline a function across modules, and the inline guard folds under
  a production `define`, so the capture code leaves the bundle. The dev branch logs `"moku:dev"`
  with `{ command: "renderer.capture" }` at debug level. `renderer.extract.base64` exists on the
  shared systems of both backends (8.21); it draws the stage into a texture over `app.screen`,
  cleared with `config.background`. All captures waiting for one frame share one extract.
  `onStop` answers a capture still waiting with `undefined`.

### Pose helpers (engine-internal)

`sync/pose.ts` exports two pure functions over `world.ecs`. They are not root exports: `input`,
`anim` and `ui` import them from `../renderer/sync/pose` and never walk the `Parent` chain
themselves.

| Function | Answers |
|---|---|
| `rootPoseOf(ecs, entity, own?)` | The entity's `Transform` composed through its `Parent` chain, every pivot applied: where it really is in reference space. `own` replaces its own `Transform` (the rest pose, for `anim.at`). The answer keeps the entity's pivot, so writing it into the `Transform` of an entity without a parent does not move the view. |
| `localPoseOf(ecs, parent, root)` | The inverse: the local pose under `parent` that lands on `root`. `parent` 0 answers `root` itself. A parent collapsed to scale 0 counts as scale 1. |

```ts
// A board cell at (100, 200) inside a slot at (40, 60) scaled 0.5.
const world = ctx.require(worldPlugin);
rootPoseOf(world.ecs, cell); // { x: 90, y: 160, rotation: 0, scale: 0.5, pivot: { x: 0, y: 0 } }
localPoseOf(world.ecs, slot, { x: 90, y: 160, rotation: 0, scale: 0.5, pivot: { x: 0, y: 0 } });
// { x: 100, y: 200, rotation: 0, scale: 1, pivot: { x: 0, y: 0 } }
```

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
| `debug` | `{ nineSlice }` | `{ nineSlice: false }` | Debug drawing at start; `sync.debug.nineSlice(on)` switches it at run time. |

```ts
const app = createApp({
  plugins: [...screen, boardFeature],
  pluginConfigs: { renderer: { mount: "#game", background: 0x101018 } }
});
```

`orientation`, `referenceSide` and `referenceLong` are read from the framework config, not from
here. `referenceLong` (default 1920) is the long side the layout needs inside the safe area: a
768×1024 tablet then gets 1440×1920 units instead of 1080×1440, so the whole UI scales together.

## The frame

| `time` phase | What `renderer` does |
|---|---|
| `sync` | The `renderer.sync` system runs one pass: removed views, layers, added views, changed components, invalidated texture keys. |
| `input` | `monitor` marks the frame start for `stats()` and starts the draw count of the frame at 0. |
| `render` | A pending resize is applied, then `app.renderer.render(app.stage)` when `ready`, then `monitor` closes the frame and its draw count and hands it to a waiting `capture()`. |

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
0 and the transform moves to the wrapper. A wrapper sorts its children: a parented entity takes
`zIndex` from its `Order` (0 without one) when it is attached and when `Order` changes, whatever
layer its parent is in. The parent's own visual has depth 0, so a child with the same depth draws
above it and a child with a negative `Order` below it. A layer container keeps its own sort rule.
A clipping parent (`Shape.clip`, `NineSlice.clip`) masks only its children. Its wrapper holds the
parent's own visual, a sortable `Container` labelled `children#<entity>` that the children hang in,
and the mask `Graphics` (`clip#<entity>`) beside it, so the mask never cuts the parent's stroke or
its corners. The children keep their `Order` inside that container, which draws above the visual:
under a clipping parent a negative `Order` sorts among the children, never below the parent. Filters
stay on the wrapper and cover the visual and the children; the debug outline stays outside the
mask. Turning `clip` off moves the children back into the wrapper and frees the container and the
mask.
Removing `Parent` puts the view back in the layer its `Layer` names, at its own pose, in the same
pass: `world` records no change for a removed component, so `sync` watches `onRemoved(Parent)`.

## Textures

`resolve(key)` asks the providers from the newest to the oldest; the first non-`undefined` wins.
Nothing answers: the view draws `Texture.WHITE` at 64×64 with tint `0xff00ff`, and `ctx.log.warn`
reports the key once. The key is not asked again per frame — only `invalidate(keys)` makes it
resolve again. `assets` owns texture lifetime: it calls `create` (or `slice` for a packed file),
answers through its provider, and calls `invalidate` then `destroy` on unload. The renderer never destroys a texture by itself; the
crops it cuts for `"cover"` sprites share the base's source. A crop is freed when its last sprite
lets go, with its base (`destroy`), when its key answers a new texture, and when the renderer stops.

### Slices of an atlas page

A packed bundle of `assets` loads one page per atlas, makes it with `create`, and cuts each file
out of it with `slice(page, frame, { nine })`, the frame of the manifest `atlas` field. The slice is
a new Pixi texture over the page's source: no pixel is copied, `width` and `height` are the frame's,
and `nine` becomes its `defaultBorders`. The frame is offset by the page's own frame, so a slice of
a slice lands right; a page is a full-source texture, so the offset is 0 today.

```ts
// `assets`: the page "ui/main-0" landed; the packed button is cut out of it with its borders.
const renderer = ctx.require(rendererPlugin);
const button = renderer.sync.textures.slice(page, { x: 583, y: 595, width: 256, height: 128 }, { nine: [24, 24, 24, 24] });
button.width; // 256
button.defaultBorders; // { left: 24, top: 24, right: 24, bottom: 24 }
renderer.sync.textures.destroy(button); // the wrapper goes, the page's source stays
```

The renderer marks every slice (`state.sync.slices`, a `WeakSet`). `destroy(slice)` frees only the
wrapper; `destroy(page)` frees the source, as for any texture. `assets` releases slices first, then
pages. A slice destroyed after its page frees its wrapper and never asks for the source again;
destroyed twice, it is a no-op. The mark outlives `onStop`, so a release after the renderer stopped
still keeps the page's source. A frame outside the page, or with a negative number, throws
`[game] renderer.sync.textures.slice: frame 583,595 256x128 is outside page 512x512.` with the hint
`Run "bun run assets:pack".`: the packer checks it, so this catches a stale manifest.

To `sync` a slice is one texture like any other: providers answer it by key, `invalidate`, pools
and `byKey` work by key. A `NineSlice` drawn from it copies the slice's borders on every write, and
Pixi cuts them against the slice's frame. A `"cover"` sprite crops relative to the texture's frame,
so its crop stays inside the slice and is freed with it.

### Nine-slice borders and the debug outline

Pixi reads a texture's `defaultBorders` only in the `NineSliceSprite` constructor, so every write
of a `NineSlice` copies them into `leftWidth`, `topHeight`, `rightWidth` and `bottomHeight`, divided
by `source.resolution` when it is not 1. A texture without borders gets 0, never Pixi's 10.

With `NineSlice.debug` or the global switch on, the view's wrapper gets a `Graphics` child at the top
`zIndex` (label `outline#<entity>`, `pixelLine: true`). It strokes the bounds and the four cut lines
at `L·s`, `w − R·s`, `T·s`, `h − B·s`, where `s = min(1, w / (L + R), h / (T + B))` is the factor Pixi
shrinks overlapping corners by. Cyan normally, red when `s < 1` or the texture is missing. It is
destroyed when debug goes off, when the view returns to the pool and when the renderer stops.

### Bitmap-font baseline

A BMFont `yoffset` is measured from the line top, but Pixi v8 draws a line `lineHeight − base` lower
and then centres it by `(lineHeight − fontMetrics.fontSize) / 2`. `fonts.install` sets
`baseLineOffset = 0` and `fontMetrics.fontSize = lineHeight`, so glyphs are drawn in the box `text`
measures (the fixture's display font was 12.9 u low at 54 u without it; both lines are needed).

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

- **onStart** `startRenderer` resolves the mount, loads Pixi, in a dev build swaps in the
  draw-counting classes, creates the application and appends the canvas; then, in the `onReady` callback, `viewport` creates the safe-area probe and the
  resize observer, `sync` creates the root, the world hooks and the `renderer.sync` system, and the
  `render` frame callback is registered. Inert without a document or without a mount: nothing is
  created and nothing is registered.
- **onStop** `({ config, state }) => stopRenderer({ config, state })` answers a waiting capture
  with `undefined` and forgets the frame counters, then runs the cleanups of `sync`,
  `viewport` and `host` in that order, destroys the pooled objects and the application
  (`{ removeView: true }`, `{ children: true, texture: false }`), swaps Pixi's own draw classes
  back, removes the probe and the unsupported element and clears every map, the filter slots too. It runs before `world` stops, so the world hooks are
  removed while `world` is alive. Textures are left to `assets`; a `Display` object is detached,
  never destroyed.

## Doors

`inspect.ts` holds `game.render` (key `render` in `sources`) of the editor's read door,
`@moku-labs/game/inspect`, safe in a production build. No input. It reads `stats()` and is read
again every frame (`changes: "frame"`): `renderPasses` always, `drawCalls` in a dev build.

`control.ts` holds two commands of the editor's write door, `@moku-labs/game/control`, dev builds
only. Each logs a `moku:dev` debug entry.

| Key in `commands` | id | Input | Effect | Does |
|---|---|---|---|---|
| `capture` | `game.capture` | none | read | `capture()`: a PNG data URL of the canvas after the next drawn frame. `undefined` while inert |
| `debug` | `game.debug` | `{ nineSlice: "boolean" }` | cosmetic | `sync.debug.nineSlice(on)`. Answers `sync.debug.state()` |

## Dependencies

`time` for `onFrame("input")` and `onFrame("render")` and `isPaused()` (a capture on a paused
clock), `lifecycle` for `push`/`pop` of `"background"` and `"device-lost"`, `clock` for `now()`, the
time source of the frame counters, `world` for `ecs.system`, `ecs.onAdded`/`onRemoved`/`changed`/`get`/`query` and
`projection.layers`/`keyOf`. Core APIs: `ctx.log`. `pixi.js` is a peer dependency, reached only
through `config.loadPixi`.

## What the unit tests cannot see

The tests run in plain Bun against a fake Pixi module and a fake DOM, so these belong to the e2e
station in a real browser: that `kind()` is `webgpu` in Chrome and `webgl` with
`preference: "webgl"`, that the board is visible and sorted on a screenshot, a real resize and a
device rotation, the safe area on a mobile profile, a real device loss through `device.destroy()`
and `WEBGL_lose_context`, a really hidden tab, the labels in the Pixi DevTools tree, and that the
bundle of a game without `...screen` carries no Pixi import. Also for the e2e station: `stats()` on
a real frame loop (fps near the cap, a real `managedTextures` list), and `capture()` giving a PNG
that shows the board, under WebGPU and WebGL. The real `drawCalls` number needs a GPU: the
fixture's board screen with no filter and no emitter pins it in `tests/integration/merge-game/run.mjs`
once measured, and `renderPasses` reads 1 there. CI pins only the class names and their metadata.
