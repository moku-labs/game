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
`sync`, and all three into `monitor`, which places a legend through `viewport`. `api.ts` also injects `installDrawCounting` of
`monitor/draw-calls.ts` into `host` in a dev build, already bound to the draw counter in
`state.monitor`, because `host/init.ts` must put the counter in Pixi's registry before
`new Application()`, before `monitor` exists. `host` never reads the monitor branch of the state. No file imports `pixi.js` as a value; the module object arrives from `config.loadPixi()`
and lives in `state.host.pixi`, so a game without `...screen` carries no Pixi in its bundle.

## Components

Pure, made with the `component()` helper of `world`, exported from the package root.

| Component | Defaults | Meaning |
|---|---|---|
| `Transform({ x, y, rotation, scale, pivot })` | `0, 0, 0, 1, { x: 0, y: 0 }` | Reference units, radians, uniform scale. Relative to the `Parent` when there is one. `pivot` is the local point the view turns and scales around; `x`, `y` is where it lands. |
| `Sprite({ texture, tint, alpha, anchor, width, height, fit })` | `"", 0xffffff, 1, { x: 0.5, y: 0.5 }, 0, 0, "fill"` | `texture` is an asset key. `width`/`height` are the box in reference units; 0 keeps the texture's own size on that axis. `fit` is `"fill"`, `"contain"` or `"cover"`. `alpha` fades the quad and the entity's children. |
| `NineSlice({ texture, width, height, alpha, tint, debug, clip })` | `"", 0, 0, 1, 0xffffff, false, false` | Size in reference units; the borders come with the texture (`defaultBorders`, copied on every write, 0 when the texture has none). `debug: true` draws the slice outline over it. `clip: true` masks the children of the entity to the `width × height` box, as `Shape.clip` does: a filled rectangle in the wrapper, never drawn, redrawn on a size change. The panel itself is never masked. `alpha` fades the panel and the entity's children. |
| `Parent({ entity })` | `0` | "Moves with its parent". It never decides draw order between layers. |
| `Display({ object })` | `undefined` | The game owns a Pixi object. Never pooled, never destroyed by `sync`. `effects` places its particle containers through it, on entities it owns. |
| `Shape({ kind, w, h, fill, fillAlpha, alpha, radius, stroke, strokeWidth, dash, clip })` | `"rect", 0, 0, 0xffffff, 1, 1, 0, 0x000000, 0, 0, false` | A filled rounded rectangle, or with `kind: "triangle"` a triangle that fills its `w × h` box pointing right (rotate the element for another direction; `radius` is ignored), drawn with `Graphics`, anchored top left. `fillAlpha` is the alpha of the fill alone: `0` draws only the stroke, a ring. `alpha` fades the whole shape and the entity's children (see the alpha rule under "Layers, sort and lift"). `dash` above 0 dashes the stroke: dashes of `dash` reference units, gaps of half a dash, walking the straight edges and the rounded corners sampled as arcs (`sync/shape-path.ts`). `clip: true` masks the children of the entity to the shape, never the shape itself, so its stroke is drawn whole; the mask is always filled and never dashed. Motions tween only the numeric fields, never `kind`. |

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
| `gl(): WebGL2RenderingContext \| undefined` | The WebGL2 context of the live WebGL application, read at call time like `device()`: Pixi restores a lost context itself. `effects` compiles a custom filter's GLSL with it in a dev build. `undefined` while inert, before `ready()`, while the context is lost, on the unsupported screen and on WebGPU. |
| `resolution(): number` | The resolution the application draws at now: device pixels per CSS pixel, capped by `maxResolution`, or set by `monitor.setResolution`. 1 while inert. |

### Resolution

The drawing resolution has three sources and one rule: `override ?? min(devicePixelRatio, maxResolution)`.

- `devicePixelRatio` is followed in every build: a `matchMedia("(resolution: <dpr>dppx)")` query,
  armed again for the new ratio after every change, so a window moved to a screen of another ratio,
  or a browser zoom, draws sharp from the next frame. No window or no `matchMedia`: nothing is armed.
- `maxResolution` is a number of the config (memory grows with its square).
- `app.renderer.monitor.setResolution(n)` overrides both, in every build: a player's graphics
  setting is applied by it from an effect, and the A/B runs of a debug build switch with it.
  `undefined` hands the choice back. Outside 0.5 to 4 it throws a `RangeError`.

Every change goes through one mechanism: it is remembered, and the next frame applies it on the
resize path (`viewport` lays out, `host.resize(w, h)` calls Pixi's `renderer.resize(w, h, r)`), so
a burst of changes costs one resize, the CSS size, the frame and the scale stay, only the backing
store changes. A restore after a lost device comes back at the current target, override
included. `host.onResolution(fn)` (internal) hears every applied change with `(from, to, reason)`;
the monitor writes it into the log, and B1, F12, C14 and PX1 subscribe in later blocks.

### `viewport` — `app.renderer.viewport`

| Method | Behaviour |
|---|---|
| `toReference(clientX, clientY)` | `(client − canvas rect − frame offset) / scale`. The rectangle is read at call time. Inert: the input unchanged. |
| `toScreen({ x, y })` | The inverse: reference units to client CSS pixels, `canvas rect + frame offset + point × scale`. The `game.locate` source places an element or a view on the page with it. Inert: the same numbers, a fresh object. |
| `size()` | Reference units, a fresh object. `scale = min(short / referenceSide, (long − safe insets) / referenceLong)`: the short side is at least `referenceSide` and grows on a wide screen, the long side inside the safe area is at least `referenceLong`. Inert: the `aspect.min` frame, `scale: 1`, zero safe area. |

### Safe area

`viewport` measures the safe area with two hidden probes on the body: `start` is the left inset wide
and the top inset tall, `end` the right inset wide and the bottom inset tall. One element padded by
all four would measure `left + right` by `top + bottom`, so a rotation that swaps the left and the
right inset would change nothing a `ResizeObserver` sees; with one inset per axis every change of an
inset is a change of size. Each size is a CSS custom property that falls back to the page's
`env()` value:

| Inset | Declared as |
|---|---|
| top | `var(--moku-safe-top, env(safe-area-inset-top, 0px))` |
| right | `var(--moku-safe-right, env(safe-area-inset-right, 0px))` |
| bottom | `var(--moku-safe-bottom, env(safe-area-inset-bottom, 0px))` |
| left | `var(--moku-safe-left, env(safe-area-inset-left, 0px))` |

A page, a game or the native shell sets the properties on `:root`; any CSS length works, `env()`,
`max()` and `calc()` included, in CSS pixels of the page. A negative value counts as 0. With no
property set the insets are `env(safe-area-inset-*)`.

```css
/* The game's page or @moku-labs/native: keep 24 px clear at the top on a phone that reports no notch. */
:root {
  --moku-safe-top: max(env(safe-area-inset-top, 0px), 24px);
  --moku-safe-bottom: max(env(safe-area-inset-bottom, 0px), 48px);
}
```

One observer watches both probes, and the window event `moku-native:insets` (the native shell sends
it when it sets the properties or its insets change) does the same; its `detail` is not read. Both
only raise the resize flag, so an inset that arrives late (an Android WebView), a rotation that keeps
the container's size, or a shell that sets its own insets is laid out at the next frame, once per
frame at most. There is no `setInsets`: a number a game stores is stale after the next rotation,
while a CSS value is worked out by the browser at the moment the engine reads it. The probes are
internal markup: select them by nothing, set the properties instead.

### `sync` — `app.renderer.sync`

| Method | Behaviour |
|---|---|
| `hitTest(x, y, accept)` | Reference coordinates, topmost first. Component math, never a Pixi world matrix. Inert: `undefined`. |
| `hitAll(x, y)` | Every entity whose hit box holds the point, topmost first, with the walk and the skip rules of `hitTest` and no filter: the caller filters. `hitTest` stays the per-pointer fast path that stops at the first accepted hit. A fresh array. Inert: `[]`. The `game.at` source reads it. |
| `boundsOf(entity)` | The axis-aligned bounds, in reference units, of the four corners of the view's hit box brought through its `Transform` and `Parent` chain, rotation included. `undefined` without a view, for a view in no tree, hidden or at an effective alpha of 0.01 or less, and for bounds without area (a scale of 0 too), so a located element is one the player sees. A fresh object. Inert: `undefined`. The `game.locate` source of `ui` and the legend of `capture()` read it. |
| `hitBoxOf(entity)` | The very box `hitTest` tests for the view, in the entity's own units, before the `Transform` and the `Parent` chain: `{ x: -32, y: -32, width: 64, height: 64 }` for a 64 x 64 `Sprite` with the default anchor, `{ x: 0, y: 0, width: w, height: h }` for a `Shape`. A fresh object; `undefined` without a view. `input` fits the circle of a trace in it. |
| `textures.provide(fn)` | Adds a provider to the chain; the newest is asked first. Returns the remover. Works while inert. |
| `textures.create(image, { nine?, mips? })` | Makes a Pixi texture, so `assets` never imports Pixi. `nine` is left, top, right, bottom in pixels. `mips: true` uploads it with its full mip chain (`Texture.from({ resource, autoGenerateMipmaps: true })`), for a texture its bundle's `mipmaps` selects; it costs about a third more. Throws while the renderer does not draw. |
| `textures.slice(page, { x, y, width, height }, { nine? })` | Cuts a texture out of an atlas page for `assets`: a wrapper over the page's source, its frame in page pixels offset by the page's own frame, `nine` as in `create`. Throws while the renderer does not draw, and when the frame does not fit in the page. See "Slices of an atlas page". |
| `textures.destroy(texture)` | `texture.destroy(true)`; a slice `destroy(false)`, the wrapper only. The crops cut from it go too. Twice is a no-op. Before a source goes, the `change` listeners of the source and of its style are removed: Pixi 8.22 keeps batch bind groups forever, and each would warn `[BindGroup] ... destroyed while still bound to a shader`. |
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

### `invalidate` — `app.renderer.invalidate(entity)`

| Method | Behaviour |
|---|---|
| `invalidate(entity)` | Tells the renderer, **before** the write, that the Pixi object of an entity's view is about to change in a way it cannot see: a game's own `Display` object, a filter value of `effects`, a particle step. With `onDemand` the frame is drawn when the view was or will be seen (see "Render on demand"); without it nothing changes. No whole-frame form: whole frames come from the renderer's own reasons. Inert, and for an entity without a view: a no-op. |

### `monitor` — `app.renderer.stats()`, `app.renderer.capture()`, `app.renderer.monitor`

| Method | Behaviour |
|---|---|
| `stats()` | `{ fps, drawn, frameMs, textures, textureMb, textureMbSplit, views, pooled, renderPasses, renderPassesMax, kept }`, plus `drawCalls` in a dev or debug build, a fresh object. Inert: all 0, `kept` `{ pictures: 0, mb: 0, retakes: 0 }`. |
| `monitor.stream(listener)` | Agent builds: the performance log, line by line (see "The log"). The unsubscribe; a second call does nothing. Without the flag the listener is never called. |
| `monitor.frames()` | The frame ring: typed-array columns written in place, the same object every call; `ring.read(into, cursor)` copies the new frames into the caller's arrays without allocating. Capacity 0 without the flag. |
| `monitor.mark(label)`, `monitor.event(name, detail?)` | Agent builds: a mark, an event at the frame it happens in (`scene`, `bundle`, `switch`, the editor's `command`, `recorder`, `devtools`, …). Nothing otherwise. |
| `monitor.beginAgent()`, `monitor.endAgent()` | For engine plugins and the editor's page agent. Agent builds: bracket the agent's own work, measured as the `agent` phase, left out of the spike rule and handed to `time.chargeAgent`. A nested begin and a lone end are ignored. |
| `monitor.setResolution(n \| undefined)` | Every build: draws at `n` from the next frame; `undefined` goes back to the policy (see "Resolution"). Answers the resolution of the next frame. |

`frameAt(ring, age)` (root export) turns one slot into a plain record: NaN as `null`, bits as
names, the path id as the flow path. `textureMbSplit` splits `textureMb` into the art a game loaded,
the render targets Pixi draws into, and the pictures the engine keeps (`host.keep`, from F12/C14).
| `capture(options?)` | Dev builds only. `{ png }`: a PNG data URL of the whole canvas, bars included, taken right after the next frame is drawn; at once while the clock is paused. `{ png, legend }` with `legend: true`. `undefined` in a production build, while inert, lost or unsupported, and when Pixi cannot read the frame (logged). Options: `legend`, `layers`, `sheet`, `against`; see "Capture". |

- `fps` counts the frames of the loop, drawn or not, over one second of `clock` time; 0 before the
  first full second and when no frame ran in the last second. A gap over one second, a pause or a
  hidden tab, restarts the window instead of reading as one slow frame.
- `drawn` counts the frames really drawn over the same second: equal to `fps` without `onDemand`,
  0 on a screen at rest with it. `drawCalls` is the count of the last drawn frame: a skipped frame
  keeps it.
- `frameMs` is the mean CPU work of a frame over the same second: from the renderer's callback in
  phase `input` to the end of `render`. The clock is the `clock` plugin's: lint L3 keeps the device
  clock out of the renderer. `clock.now()` is whole milliseconds, so one frame reads 3 or 4 ms and
  the mean over a second is exact enough.
- `textures` counts the live sources in Pixi's `renderer.texture.managedTextures`, on WebGPU and
  WebGL alike. Pixi 8.22 builds that list with `Object.values` of a `GCManagedHash`, which keeps a
  `null` slot for every unloaded source, so the `null` slots are skipped for the count and the bytes.
- `managedTextures` is deprecated since Pixi 8.15. Pixi 8.22 has no public replacement: the
  `GCSystem` keeps its resource hashes private.
  `textureMb` estimates their memory: 4 bytes per pixel (PNG and WebP decode to RGBA8), every mip
  level, in MiB.
- `views` and `pooled` are read from the `sync` state. `renderPasses` is the measured count of the last drawn frame,
  `renderPassesMax` the most of one drawn frame in the last full second (see "Render passes"). `kept` reports the
  kept pictures (see "Kept pictures"): the quads drawn in the last drawn frame, the MiB their textures hold, the
  pictures taken in the last full second.
- The frame timing costs two `clock.now()` calls and a few number writes per frame; no allocation.
  The rest is read only when `stats()` is called.

#### Render passes

`stats().renderPasses` is measured in every build (F8): on WebGPU an encoder subclass counts every
`beginRenderPass` inside a frame (the six counting classes of a dev or debug build count it too; a
production build swaps the encoder alone, one boolean test and one typed-array increment per pass);
on WebGL the public runners count a bound target (count-only items in a production build). A frame
that is not drawn counts nothing and keeps the number of the last drawn frame; `renderPassesMax` is
the most of one drawn frame in the last full second, so the frame that took a picture shows there.
Where nothing counts (headless, a test stage, a fake application) both report the estimate below.

`sync.renderPasses()` is the estimate, computed from the filter slots `sync` holds, never asked of the GPU, at call time:
0 while inert; otherwise `1 + Σ over views in the tree with an enabled filter (1 + Σ passes of the
enabled slots)`; a view drawn from its kept picture costs nothing, and the passes the last flush of the kept
pictures made are added (1 per subtree picture, 1 + the slots' passes per filter output, 1 per range picture). A filtered view costs one pass for its content and one per filter apply (spike
P10); a disabled filter costs nothing, and a view whose filters are all disabled counts 0. A view
out of the tree (an unknown layer) counts 0. The pins from P10: no filter `1`; one glow of 1 pass
on a button `3`; one full-screen blur of quality 4 (8 applies) `10`; a glow and a tint on ten
buttons `31`. The renderer is the one owner of this number; `effects` declares the passes per kind
and reads `sync.renderPasses()` for its budget warnings: the same number, without the texture walk
and the fresh object of `stats()`.

#### Draw calls

`drawCalls` is counted in dev and debug builds only, on WebGPU. Under WebGPU three Pixi 8.22 classes issue
every draw of the scene: `GpuBatchAdaptor.execute` (one `drawIndexed` per batch),
`GpuGraphicsAdaptor.execute` (one per instruction of the graphics context) and
`GpuEncoderSystem.draw` / `drawIndirect` (meshes, tiling sprites, particles, filters).
`monitor/draw-calls.ts` builds counting subclasses of them from the module object, each with the base's `static extension` object, and `host/init.ts` swaps them in
through `pixi.extensions.remove` and `add` after `loadPixi()` and before `new Application()`,
because Pixi builds its systems and adaptors inside `init`. No native prototype and no Pixi
instance is patched. The swap happens once per host state: a restore after a lost device reuses the
classes. `onStop` swaps Pixi's own classes back, so a second `createApp` on the page (HMR) starts
from them. A Pixi module without the three classes draws on uncounted, with `ctx.log.warn`.

The install sits behind the inline dev or agent guard (a dev page and a debug page count draws)
and logs `"moku:dev"` with `{ command: "renderer.monitor" }`, so a production `define` folds it
and the counter leaves the bundle; `stats()` then has no `drawCalls` field. The guard is the one of
`capture()` written as a positive branch (`(typeof __MOKU_GAME_DEV__ !== "undefined" &&
__MOKU_GAME_DEV__) || (typeof __MOKU_GAME_AGENT__ !== "undefined" && __MOKU_GAME_AGENT__)`): Bun 1.3.14 drops
code used only inside a folded `if`, but keeps code used after a folded early `return`. `api.ts`
hands `host` the counter under the same guard, so a production build drops the counter module. `begin()` starts the count of a frame at 0 and
`end()` closes it, so a draw between frames, as a capture's extract, is not counted. The WebGL
fallback reads 0: the three classes are WebGPU ones. Known misses: Pixi 8.22 issues two kinds of
native draws outside the three classes, and no subclass sees them. The MSAA restore
(`GpuMsaaRestore`) draws the kept colour of a multisampled target back in, one `pass.draw(3)` per
colour attachment, each time a pass reopens that target, as the screen after a filter. It runs
only with `antialias: true`, whose default is false, and then only on a tile-based GPU (Apple, ARM,
Qualcomm, Imagination) or on a target marked `transient`. The mipmap generator
(`GpuMipmapGenerator`) draws every level below the first with one `draw(3)`, each time a source
with `autoGenerateMipmaps` is uploaded or updated. The project pins 8.22.0, and a unit test against
the real module pins the three names, their `extension` metadata and their methods.

#### Measuring frames (agent builds)

In an agent build (`__MOKU_GAME_AGENT__`: dev pages and `--debug` builds) the monitor attaches at
the first ready and after every restore. `time.measure` hands it every frame (the gap, the ticks the
cap skipped, the six phases, the start delay, the work, one frame of the loop's rate); the commit
writes one slot of the ring from it and from what the counting classes saw: render passes where
Pixi begins them (stencil passes on WebGPU), draws, filter applies with their pixels and the four
filter kinds with the most, uploads with their bytes, pipeline compiles, the five slowest world
systems (`world.systemTimes()`), the flow path, the changes of the frame (resize, resolution,
scene, bundle, restore). The counting is six subclasses swapped in through `extensions`
(`GpuBatchAdaptor`, `GpuGraphicsAdaptor`, `GpuEncoderSystem`, `FilterSystem`, `GpuTextureSystem`,
`GlTextureSystem`); on WebGL a pass is a bound target, seen on Pixi's public runners. Compiles are
counted on GPU objects of this application only: own properties on the engine's own device and
`linkProgram` on this app's WebGL context. Long Animation Frames come from a `PerformanceObserver`
(long tasks where the browser has no LoAF, none on WebKit), the heap from Chromium's
`performance.memory`. The per-frame path allocates nothing: indexed stores into typed arrays
allocated once; a dev-only probe (`monitor-alloc.test.ts`, under Node's heap sampler) checks it.
`monitor/clock.ts` is the one renderer file that reads the page clock (lint L3 ignores it).

**The spike rule.** The budget of a frame is one frame of its own rate (`monitor.budgetMs: "rate"`,
the default): 8.33 ms at the 120 fps target, 16.7 ms at the 60 fps fallback; a number is a fixed
line. A frame is a spike when its gap, the agent's work left out, is over `1.5 × max(budget,
cap)` (`gap`), when its work, the agent's left out, is over the budget (`js`), or when its GPU time
lands over the budget (`gpu`). With `budgetMs: 16.7`: a gap of 25.0 ms is no spike, 25.1 ms is; at
the idle cap of 30 fps the line is 50 ms. A spike is annotated with `compile`, `upload` (1 MB or
more), `longFrame` (an overlapping Long Animation Frame) and the hint `gc?` (a gap with little work
after the heap dropped by 0.5 MB or more: Chromium only, a hint, never a certainty). A stepped
frame is never a spike.

#### The log

`monitor.stream(listener)` hands a listener one JSON object per line, every one with `v: 1`
(`PERF_LOG_VERSION`), `kind`, `t` (page epoch ms, `performance.timeOrigin + performance.now()`) and
`build` (spec 10's build id, `null` on a page without one). Every line is a fresh object, frozen all
the way down: a listener may keep it. A reader skips a kind or a field it does not know; "not
measured on this build or backend" is `null`, never 0.

| Kind | When |
|---|---|
| `header` | At once to each new subscriber: the device (model from the native shell, else the user agent), the GPU and its timer, the display, the shell's thermal reading, the loop's frame rate (`rate`, `time.rate()`), the config, what is measured. On the native shell it waits for `__MOKU_NATIVE__.ready`, 500 ms at most. |
| `startup` | Once, at the first flush after the first drawn frame, and to every later subscriber after its header: HTML, the bundle's download, parse, evaluate, the Pixi chunk, `app.init`, the first frame, the boot long frames. |
| `sample` | Once a second of page clock (and on a pause, for the partial second): counts, gaps with their histogram (`PERF_GAP_BUCKETS`), work, phases, systems, GPU time, passes, draws, filters, uploads, compiles, long frames, heap, textures, what measuring cost. |
| `spike` | At a flush, once its GPU time landed or a flush later: the frame's record, systems, compiles, filters per kind, passes with GPU time, kind and label, the long frames around it. |
| `longFrame` | When the observer delivers one. |
| `event` | As it happens: `resolution`, `device-lost`, `device-restored`, `pause`, `resume`, `display`, `compile`/`upload` (at a flush), `rate` (every `time:rate`, the payload as its detail), and every `monitor.event` call. |
| `mark` | `monitor.mark(label)`, and an auto mark when the flow rests on a new path. |
| `thermal` | Every `time:thermal` reading of the native shell. |

The engine sends nothing anywhere: the listener decides (the editor's page agent posts the lines to
its collector). Without a listener no line is built; the ring records anyway.

#### GPU time

On WebGPU with the engine's own device (agent builds request it with Pixi's features plus
`"timestamp-query"`, handed to Pixi as `webgpu.gpu`), the first 32 passes of a frame carry
timestamp writes, resolved into Pixi's own command buffer and read back per batch of up to eight
drawn frames. A late time is written into the slot of its frame and clears `gpuPartial`; a 33rd
pass or a busy batch keeps the flag. On WebGL the disjoint timer query times each render call
where the browser has it (no time per pass). Chrome rounds stamps to 0.1 ms unless its flag is set.
Compare frame pacing and late frames across rates, never raw GPU ms: the A26's GPU clocks down at
60 fps and its ms rise.

#### What is not counted

Passes Pixi opens on command encoders of its own (a stand-alone clear between frames, the mipmap
generator, the MSAA restore), a pass outside a frame (an extract, a capture), and an upload between
two frames (zeroed by the next frame's start; Pixi uploads lazily at the first draw, inside a frame).
The passes of the kept pictures are counted: they are rendered inside the frame, before the stage
pass (`kept:<label>#1|#2.<k>|#3` and `freeze:<id>` name them in an agent build's pass records). A
WebGL pass has no stencil count and no GPU time of its own. A WebKit page reports no long frames.

#### Capture

- `capture()` guards with the dev or agent refusal `(typeof __MOKU_GAME_DEV__ === "undefined" ||
  !__MOKU_GAME_DEV__) && (typeof __MOKU_GAME_AGENT__ === "undefined" || !__MOKU_GAME_AGENT__)`
  inline, not with `isDev()`: Bun does not inline a function across modules, and the inline guard
  folds under a production `define`, so the capture code leaves the bundle; a debug page keeps it.
  `game.capture` with `diff` writes the state, so on a `--debug` page it throws `controlReadOnly`. The dev branch logs `"moku:dev"`
  with `{ command: "renderer.capture" }` at debug level, plus `options: [...]` with the names of the
  options given (`legend` counts when true). `renderer.extract.base64` exists on the
  shared systems of both backends (8.22); it draws the stage into a texture over `app.screen`,
  cleared with `config.background`. The captures due on one frame with the same layers and legend
  share one extract. `onStop` answers a capture still waiting with `undefined`.
- **Timing.** A picture is taken right after the next drawn frame (`monitor.end()`), at once while
  the clock is paused. A capture still waiting when the game pauses is served by the
  `lifecycle:changed` hook (`paused: true`) one microtask later, so a pause inside a frame lets
  that frame end first: a plain capture is taken at once, a running sheet steps what is left of its
  spacing, or nothing when an earlier sheet served on the same pause stepped past it. The hook
  carries the same positive dev or agent guard as the draw-call counter, so a production build drops it with
  the capture code. A clock that runs again by then leaves it to the next frame. The legend is measured on that same frame, in the same call as the extract's
  synchronous render; only the PNG encode comes later. Every option draws on the picture after the
  extract, on an `OffscreenCanvas` 2D context (`monitor/picture.ts`): the player never sees a toggle
  or a badge.
- **`layers`** draws only these layers of the scene. Every name must be in
  `world.projection.layers()`, else `[game] game.capture: layer "sky" is not in the scene.` with the
  names to use; `[]` throws `[game] game.capture takes at least one layer.` `host.extract(hidden)`
  sets `visible = false` on the containers of the other layers (`sync.layerContainer`) around the
  synchronous `extract.base64` call and sets them back right after it returns its promise, also when
  it throws; a container hidden already stays hidden. A `Parent` child follows its parent's layer.
- **`legend`** numbers every entity of `world.ecs.snapshot().entities` that has a
  `projection.keyOf` address and a `sync.boundsOf` box, in a layer drawn: a ui element with a visual,
  a board view. A bare button without a fill has no box and no number. `rect` is the box through
  `viewport.toScreen`, minus the canvas's `getBoundingClientRect` origin, times the Pixi resolution,
  rounded: picture pixels. Entries are sorted by `rect.y`, then `rect.x`; `n` counts from 1 in that
  order. A badge sits at each rect's top-left corner: the number in a `12 × resolution` px
  sans-serif, white on a black box with 2 px padding. Without the option the answer has no `legend`.
- **`sheet: { frames, everyMs }`** takes 2 to 12 whole frames, `everyMs` above 0 and at most 5000,
  else `[game] game.capture takes a sheet of 2 to 12 frames, every 1 to 5000 ms.` Frame 1 is taken as
  above. Between frames, a paused clock runs `time.step(everyMs)` once, what `game.step` does, with
  a `moku:dev` entry `{ command: "renderer.capture", step: everyMs }`; this is the only thing a
  capture does to the game, dev only. A running clock is waited for until `time.snapshot().elapsed`
  grew by `everyMs` (scaled game time, so `game.timeScale` stretches a sheet), and the frame drawn
  then is taken; after 600 drawn frames without that, `[game] game.capture sheet: game time did not
  advance.` The sheet has `ceil(sqrt(frames))` columns and as many rows as needed; every cell is the
  picture scaled by `min(1, 2048 / (columns × width))`, aspect kept, with an 8 px gutter around and
  between the cells on `#202020`, left to right and top to bottom, and a badge with the frame number
  at each cell's top-left corner. The answer is `{ png }` of the sheet.
- **`against`** is a PNG data URL of an earlier capture. Both pictures are decoded with
  `createImageBitmap`; different sizes throw `[game] game.capture: the pictures differ in size.` A
  pixel differs when one RGBA channel differs by more than 24, the visual runner's default. The
  answer shows `#ff0000` where pixels differ and the current picture faded elsewhere: its grey
  (`0.299 r + 0.587 g + 0.114 b`), then `255 - (255 - grey) × 0.4`. `monitor/picture.ts` has its
  own compare: `src/visual/page-script.ts` keeps its copy, since Playwright serialises that file's
  functions and lint L12 keeps `src/visual/**` out of the plugins.
- **Combinations.** `layers` combines with everything. `legend` combines with `against`: the badges
  of the current frame on the diff picture. `sheet` with `legend` or `against` throws
  `[game] game.capture takes a sheet on its own.`
- **No 2D canvas.** Where `OffscreenCanvas` is missing, a capture with no option still answers
  `{ png }`; one with an option throws `[game] game.capture needs OffscreenCanvas for legend.` with
  the first option given. While inert the answer is `undefined` before that check; the values of
  the options are checked first, in every state.

### Pose helpers (engine-internal)

`sync/pose.ts` exports pure functions over `world.ecs`. They are not root exports: `input`,
`anim` and `ui` import `rootPoseOf` and `localPoseOf` from `../renderer/sync/pose` and never walk
the `Parent` chain themselves; `sync` places the corners of a box with `rootPointOf`.

| Function | Answers |
|---|---|
| `rootPoseOf(ecs, entity, own?)` | The entity's `Transform` composed through its `Parent` chain, every pivot applied: where it really is in reference space. `own` replaces its own `Transform` (the rest pose, for `anim.at`). The answer keeps the entity's pivot, so writing it into the `Transform` of an entity without a parent does not move the view. |
| `localPoseOf(ecs, parent, root)` | The inverse: the local pose under `parent` that lands on `root`. `parent` 0 answers `root` itself. A parent collapsed to scale 0 counts as scale 1. |
| `rootPointOf(ecs, entity, point)` | Where a local point of the entity lands in reference space: the point through the entity's `Transform` and its `Parent` chain, with the real scale. `boundsOf` brings the four corners of a hit box through it. |

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
| `maxResolution` | `number` | `2` | Cap of `devicePixelRatio`. Memory grows with its square. A player's graphics setting is applied by `monitor.setResolution`. |
| `preference` | `"webgpu" \| "webgl"` | `"webgpu"` | Passed to Pixi. Pixi falls back to WebGL by itself. |
| `aspect` | `{ min, max }` | `{ 4 / 3, 21 / 9 }` | Allowed long side / short side. A window outside it gets bars. |
| `poolLimit` | `number` | `256` | Display objects kept in all pools together. |
| `unsupportedMessage` | `string` | `"This device cannot run the game."` | Text of the unsupported-device screen. |
| `loadPixi` | `() => Promise<PixiModule>` | `() => import("pixi.js")` | Loader seam. Tests pass a fake module. |
| `debug` | `{ nineSlice?, verifyFrames?, kept? }` | `{ nineSlice: false, verifyFrames: false, kept: true }` | Debug drawing and checks at start, a switch left out is off (`kept` left out is on); `sync.debug.nineSlice(on)`, `sync.debug.verifyFrames(on)` and `sync.debug.kept(on)` switch them at run time. `verifyFrames` works in dev and debug builds only. |
| `onDemand` | `boolean` | `false` | Draw a frame only when something on the screen changed (see "Render on demand"). Off: every frame is drawn, as before. |
| `monitor` | `{ budgetMs, frames }` | `{ budgetMs: "rate", frames: 1024 }` | Agent builds: a frame over `budgetMs` is a spike (`"rate"`: one frame of the frame's rate, 8.33 ms at 120 fps, 16.7 ms at 60); the ring keeps `frames` (64 to 16384), render passes 4x as many. |
| `keptMb` | `number` | `64` | MiB the kept pictures may hold (see "Kept pictures"); the least recently drawn goes first when it is full. `0` keeps none. Not a finite number of at least 0 throws at `createApp`. |

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
| `render` | A pending resize is applied, then the overlay step (spec 22), then `kept` reads the marks, `demand` decides whether the frame is drawn; a drawn frame renders the kept pictures first (`kept.flush`), then `app.renderer.render(app.stage)` when `ready`, then the pixel leg of the kept oracle; then `demand` settles it (the dev check, the pixel check) and `monitor` closes the frame, its draw count and its pass count and hands a drawn one to the `capture()` calls due on it. |

Pixi's own ticker never starts: `time` owns the one loop. The pass touches only what changed, and a
throw costs one entity, not the frame: it is reported with `ctx.log.error` and the label of the view.

## Render on demand

`pluginConfigs: { renderer: { onDemand: true } }` draws a frame only when the player could see a
difference; the loop keeps its rate, so input, systems and `sync` run every frame. Off by default:
every frame is drawn, as before. `stats().drawn` counts the frames really drawn.

A frame is drawn for a counted change mark, a resize or a new resolution, a device restore, a new
list of layers from the scene, the nine-slice switch, a wake of `time` since the last frame
(`time.wakes()`), a waiting `capture()`, a frame the engine asks for itself, and the first frame
after the host came up. Otherwise `app.renderer.render` is skipped and the canvas keeps its last
picture.

Where the marks come from. `sync` is the only writer of Pixi for the engine's views: every write
site compares the new value with what Pixi holds (or, for the path of a `Shape` and the mask of a
clip, with what the engine drew last) and marks the entity before the first write that differs, so
an equal write writes and marks nothing; a structural write (attach, detach, a wrapper, a new
filter list, a new or pooled view, a Display swap, a texture key resolved again) always marks. A
plugin's display adapter reports its own write by answering anything but `false` from `update`
(`text` answers `false` for a label it left as it was). Everything else calls
`renderer.invalidate(entity)` **before** its write: `effects` before it writes a filter value, the
particle system around a step, a game before it writes into its own `Display` object. From a world
system, which has no plugin context, write the component again
(`world.set(entity, Display, { object })`): the renderer attaches and measures it again, a
structural write.

Which marks count. A mark counts only when its view is drawn now or was at the last drawn frame
(F6): a loop under a hidden ancestor (alpha 0, `visible` or `renderable` false) asks for nothing,
and the frame a view hides or shows is drawn, because a mark is judged before its write and again
when the frame is decided. A leaf fully off the screen, the padding of every filter on its chain
included, is not drawn (F18a); a view with children is never exempt.

Pixi's change lists are never read to decide. A dev build reads them on a skipped frame only to
warn: `renderer:missed-mark` names a view written without a mark, once per entity (the fix: call
`renderer.invalidate(entity)` before writing into the `Display` object). `sync.debug.verifyFrames(true)`
(dev and debug builds, door `game.debug { verifyFrames: true }`) compares every skipped frame with
the same frame drawn live, by pixels at half resolution: a difference logs `renderer:missed-frame`
with the views marked since the last drawn frame and draws the frame at once. With `onDemand` off it
runs in shadow, so a game can be checked before it turns `onDemand` on. It costs one read-back per
frame. The visual runner's browser leg turns it on for every test (`--no-verify-frames` leaves it
off).

## Kept pictures

A view whose filters allow it is kept as a picture while nothing it depends on changes: its subtree is
rendered once into an engine-owned texture (stage 1, `kept:<label>#1`), the pre-pass of its first
enabled filter with inputs runs once over that picture into engine-owned targets (stage 2,
`#2.<k>`, spec 24's `FilterSlotInputs`), and the filter stack runs once over both into a third
texture (stage 3, `#3`). The stage pass then draws one sprite, the quad, in the view's place, while
the view itself is hidden (`renderable = false`, reason `"kept"` of `sync/hidden.ts`, swapped
without a mark: both draw the same pixels). Every render happens in a flush before the stage pass,
so the canvas stays one pass. A picture's render makes the top a render group while it is kept; a
top drawn live again stops being one (drawn with its filters inside a parent's filter pass, a render
group draws other pixels than the container did: found by the browser leg). On by default
(`renderer.keptMb: 64`); `keptMb: 0` turns it off and the renderer draws as before.

What each stage depends on, and the only stage redone when it changes:

| Change | Redone |
|---|---|
| A mark under the view, its own alpha or tint, a `Display` or adapter view's own `invalidate`, its world scale or rotation, the stack resolution | stages 1, 2, 3 |
| What the chain of the first filter with inputs draws (`inputs.version()`) | stages 2, 3 |
| A filter value (`effects` calls `invalidate` before the write), the renderer resolution, the padding, a `"placed"` filter's move | stage 3 |
| A move of the view itself | nothing: the quad moves |

Moving and changing. A view that moves keeps its picture: only the quad's position is written. A move
of a fraction of a texel draws the quad off its grid (sampled linearly) while it moves; at rest it is
taken once more at its new phase (a settle retake, for which one frame is asked). Adaptivity: a view
is taken after it stood still for 2 drawn frames; a kept view whose subtree changes in 3 drawn frames
in a row goes back to drawing live until it stood still for 8 (a picture that churns costs one pass
more than live). A kept view inside another is rendered first; its change retakes the outer one too.

Not kept: a filter of category `"screen"` (see the effects README, "Filters that are kept"), a slot
of a game that names no category, a filter that blends with the backdrop (`blendRequired`) or a blend
mode other than normal, a top that blends otherwise, an ancestor that is translucent, tinted or blends
otherwise (its alpha would be applied after the filter instead of before it), a `"placed"` filter
under a filtered ancestor, a view hidden for the player, a picture over 4096 device pixels on a side,
and without `onDemand` a subtree holding a `Display` view: a game that never turned `onDemand` on
never promised to call `renderer.invalidate` before writing into its own Pixi objects.

The grid. Every texture works on the pixel grid of Pixi's live filter pass: the subtree picture on the
grid of the stack's resolution (`min` of the enabled filters', `"inherit"` the renderer's), the
output at the renderer's. When the renderer resolution over the stack resolution (`r / rs`) is a whole
number the quad reproduces the live frame texel for texel at rest; otherwise (the owner's phone at
2.8125 under a `Blur` of 0.5) it is up to one device pixel off the canvas grid and sampled linearly,
which a blurred output does not show and the oracle's tolerance covers; `cache: false` on that filter
or `keptMb: 0` draws it live.

Budget. `renderer.keptMb` MiB at 4 bytes a texel. A take that would pass it evicts the pictures not
drawn in this frame, the least recently drawn first; an evicted view draws live and its textures are
destroyed. A take that still does not fit is refused, the view drawn live, `renderer:kept-budget`
logged once per run, and it is not offered again until it fits. Every texture is registered with
`host.keep` (`textureMbSplit.kept`) and destroyed explicitly: on a drop, a device loss, a rebuild and
at `onStop`. `stats().kept` is `{ pictures, mb, retakes }`.

`sync.debug.kept(false)` (door `game.debug { kept: false }`) draws every filtered view live from the
next drawn frame, `true` lets them be taken again: the A/B switch of a measurement, in every build.
With `debug.verifyFrames` on (dev and debug builds), every drawn frame in which a picture stood is
read twice, as drawn and with every picture drawn live, and compared; a difference logs
`renderer:stale-picture` and draws every view live until the policy takes it again.

Range pictures. The same machinery renders the canvas-sized picture of an overlay's range that
`Overlay` (spec 22) asks for (`take`, `retake`, `move`, `release`): one render of the stage root with
only the range drawn, shown by a sprite placed before the overlay, kept in the same budget.

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

The alpha of an entity fades its whole subtree. `Sprite.alpha`, `NineSlice.alpha` and
`Shape.alpha` are written on the wrapper when the entity has one, and the visual inside it stays at
1, so the alpha is applied once: a disabled button at 0.6 draws its disc, its icon and its label at
0.6, and a popup that fades to 0 takes its board with it. A view without a wrapper keeps the alpha
on its own object, so an entity without children draws the same pixels as before. The alpha moves
up when the wrapper is made, with the filters, and it reaches the hit test too: a child of a parent
at alpha 0 is not hit. Pixi multiplies the alpha into every child, so overlapping children show
through each other; the `effects` `Alpha` filter fades the subtree as one layer instead. A
`Display` object and an adapter object keep their own alpha: the game and the plugin that draws
them own it (`Text.alpha` is the alpha of the text's container).
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

### Distance-field text

Pixi 8.22 applies the alpha of distance-field (MSDF, SDF) bitmap text twice. Its SDF shader hands
`calculateMSDFAlpha` the vertex colour, which is premultiplied: the function raises
`vColor.a × coverage` to a gamma that leans on the luma of the premultiplied colour, and the shader
template multiplies the result by `vColor` again. A label at alpha 0.5 so drew at about 0.25, a
0.55 shadow at 0.31, a label under a parent at 0.6 at 0.42.

The renderer brings its own bitmap text pipe. `host/sdf-text.ts` builds a subclass of Pixi's
`BitmapTextPipe` from the module object, with the base's `static extension` object, and
`host/init.ts` swaps it in through `pixi.extensions.remove` and `add` before `new Application()`,
in every build, as the draw counter does. No Pixi prototype and no Pixi instance is patched. Its
`getSdfShader()` compiles Pixi's own five SDF bits with one step changed: the fragment step of
`localUniformMSDFBit` hands the function
`vec4<f32>(vColor.rgb / max(vColor.a, 1e-4), 1.0)`, the colour un-premultiplied at alpha 1. The
coverage is the glyph's alone, and the template's `outColor * vColor` applies every alpha once: the
label's (`Text.alpha` is the alpha of its container), a parent's (a disabled button, a popup fade)
and the world's. Full-alpha text draws the same pixels as before. The program is compiled once per
batch texture limit and shared by every text; each text gets its own local uniforms, as from Pixi's
pipe.

Both backends. On WebGPU the shader carries the WGSL program above. On the WebGL fallback it
carries the GLSL program, compiled with `compileHighShaderGlProgram` from the GL twins of the same
five bits (`colorBitGl`, `generateTextureBatchBitGl`, `localUniformMSDFBitGl`, `mSDFBitGl`,
`roundPixelsBitGl`), with the same step changed:
`calculateMSDFAlpha(outColor, vec4(vColor.rgb / max(vColor.a, 1e-4), 1.0), uDistance)`. A WebGL
shader also gets Pixi's batch sampler slots (`getBatchSamplersUniformGroup`), as Pixi's own
`SdfShader` does. Each backend's program is compiled once per texture limit.

The swap happens once per host state, a restore reuses the pipe, and `onStop` swaps Pixi's own pipe
back. A Pixi module without the pieces draws on with its own pipe, with `ctx.log.warn`. A unit test
against the real module pins the pipe's name and metadata, the exact WGSL and GLSL steps it
replaces, and the compiled fragment of both programs, so a Pixi that renames them, or fixes the
double alpha itself, fails in CI.

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
  draw-counting classes, creates the application and appends the canvas; then, in the `onReady` callback, `viewport` creates the two safe-area probes, the
  two resize observers and the `moku-native:insets` listener, `sync` creates the root, the world hooks and the `renderer.sync` system, and the
  `render` frame callback is registered; in an agent build the monitor then attaches (and again
  after every restore). Inert without a document or without a mount: nothing is created and nothing
  is registered.
- **onStop** `({ config, state }) => stopRenderer({ config, state })` answers a waiting capture
  with `undefined` and forgets the frame counters, then runs the cleanups of `sync`,
  `viewport` and `host` in that order, destroys the pooled objects and the application
  (`{ removeView: true }`, `{ children: true, texture: false }`), swaps Pixi's own draw classes
  back, removes the two safe-area probes and the unsupported element and clears every map, the filter slots too. It runs before `world` stops, so the world hooks are
  removed while `world` is alive. Textures are left to `assets`; a `Display` object is detached,
  never destroyed.

## Doors

`inspect.ts` holds two sources of the editor's read door, `@moku-labs/game/inspect`, safe in a
production build. Both are read again every frame (`changes: "frame"`).

| Key in `sources` | id | Input | Reads |
|---|---|---|---|
| `render` | `game.render` | none | `stats()`: `renderPasses` and `drawn` always, `drawCalls` in a dev build |
| `at` | `game.at` | `{ x: "number", y: "number" }`, page CSS px in client coordinates | What lies under the point, topmost first: `viewport.toReference(x, y)`, then `sync.hitAll`, each entity named `{ entity, owner, key, layer }` (`Under`): `world.ecs.ownerOf`, `world.projection.keyOf`, and `Layer.name` of its own `Layer` (`undefined` for a `Parent` child). An entity that despawned this frame is left out. `[]` while inert |

`control.ts` holds two commands of the editor's write door, `@moku-labs/game/control`, dev builds
only. Each logs a `moku:dev` debug entry; the one of `game.capture` lists the option names given.

| Key in `commands` | id | Input | Effect | Does |
|---|---|---|---|---|
| `capture` | `game.capture` | `{ legend: "boolean?", layers: "json?", sheet: "json?", diff: "json?" }` | read | `capture(options)`: `{ png, legend? }` of the canvas after the next drawn frame. `undefined` while inert |
| `debug` | `game.debug` | `{ nineSlice: "boolean?", verifyFrames: "boolean?", kept: "boolean?" }` | cosmetic | `sync.debug.nineSlice(on)`, `sync.debug.verifyFrames(on)`, `sync.debug.kept(on)`, each field given; `{ kept: false }` alone is the editor's A/B switch. Answers `sync.debug.state()` |

`game.capture` checks the shapes, `renderer.capture()` the values: `layers` must be a JSON array of
strings, `sheet` an object of two numbers `{ frames, everyMs }`, `diff` a bookmark (`readBookmark`
of `flow/json.ts`); a wrong shape throws `[game] game.capture: sheet has the wrong shape.` with what
to pass, before anything runs, and so does `diff` with `sheet`. `legend`, `layers` and `sheet` go to
`renderer.capture()` as they are.

`diff` is the one option the command runs itself, because it needs `flow`. While the renderer is
inert it answers `undefined` and touches nothing. Otherwise: the graph must wait at a gate with no
effect pending, else `[game] game.capture diff needs the game at rest.`; the command journals
itself, `recordCheat(app, "game.capture", { diff }, frame)` of `flow/doors/session.ts`, so
`tainted` turns true; it takes `flow.bookmark()`, restores `diff` and waits on drawn frames until the
graph rests at a gate again (at most 600, else `[game] game.capture diff: the bookmark did not come
to rest in 600 frames.`), then two drawn frames more; while the clock is paused, each frame it waits
on is a `time.step(1000 / 60)` of its own, as `game.step` does; takes `capture({ layers })`; restores where it
started and waits the same way, also when something failed; and answers
`capture({ layers, legend, against })` with the first picture as `against`. Every restore reconciles
in direct mode, so motions in flight when the command started are finished afterwards.

## Dependencies

`time` for `onFrame("input")` and `onFrame("render")`, `isPaused()` (a capture on a paused
clock), and `snapshot()` and `step()` (the frames of a sheet), `lifecycle` for `push`/`pop` of
`"background"` and `"device-lost"` and for the `lifecycle:changed` hook that serves the captures a
pause left waiting, `clock` for `now()`, the time source of the frame counters,
`world` for `ecs.system`, `ecs.onAdded`/`onRemoved`/`changed`/`get`/`query`/`snapshot`,
`projection.layers`/`keyOf` and, in an agent build, `systemTimes()`, `flow` for the flow path of
the frames in the performance log (`state()`, and the `flow:edge`/`flow:rest` hooks), `time` also
for `frameDrawn()` (every build: the render phase reports a frame Pixi drew, for the adaptive frame
rate) and `rate()` (the header), and for `measure`, `chargeAgent` and the `time:thermal`/`time:rate`
hooks in an agent build. The doors read `world.ecs.ownerOf` and, for `game.capture` with
`diff`, the app's `flow`. Core APIs: `ctx.log`. `pixi.js` is a peer dependency, reached only
through `config.loadPixi`.

## What the unit tests cannot see

The tests run in plain Bun against a fake Pixi module and a fake DOM, so these belong to the e2e
station in a real browser: that `kind()` is `webgpu` in Chrome and `webgl` with
`preference: "webgl"`, that the board is visible and sorted on a screenshot, a real resize and a
device rotation, the safe area on a mobile profile, a real device loss through `device.destroy()`
and `WEBGL_lose_context`, a really hidden tab, the labels in the Pixi DevTools tree, and that the
bundle of a game without `...screen` carries no Pixi import. Also for the e2e station: `stats()` on
a real frame loop (fps near the cap, a real `managedTextures` list), and `capture()` giving a PNG
that shows the board, under WebGPU and WebGL. The unit tests draw the options on a fake 2D canvas;
the real `OffscreenCanvas`, `createImageBitmap` and PNG encode, the badges on the picture, a sheet
and a diff picture, and a `layers` capture that leaves the drawn frame pixel-identical for the
player, belong to the e2e station too. The real `drawCalls` number needs a GPU: it is pinned once
measured on the board screen of the merge game in moku-labs/demos, which has no filter and no
emitter, and `renderPasses` reads 1 there. CI pins only the class names and their metadata.
How distance-field text draws needs a GPU too: a 0.5 label measured at 0.5, a 0.55 shadow at 0.55,
a label under a 0.6 parent at 0.6, and the same pixels for full-alpha text, in the browser, under
WebGPU and under WebGL. So does the alpha of a parent: the icon of a disabled round button measured
at 0.6 in the browser.
