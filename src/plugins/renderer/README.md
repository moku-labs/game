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
| `Overlay({ dim, dimColor, cover, hud, fade })` | `0, 0x000000, "none", "all", 250` | Marks the view an overlay is drawn from: what is drawn before its root is kept as one picture, never stale, and not drawn at all under `cover: "opaque"`; the engine draws its dim and fades the HUD parts `hud` does not keep. See "Overlays and the HUD". |
| `HudPart({ key })` | `""` | A view of the HUD layer an overlay keeps shown or lets fade, by `key`. |
| `Shape({ kind, w, h, fill, fillAlpha, alpha, radius, stroke, strokeWidth, dash, clip, sweep?, cap? })` | `"rect", 0, 0, 0xffffff, 1, 1, 0, 0x000000, 0, 0, false`; `sweep` and `cap` absent (an arc reads them as `1` and `"round"`, `arcDefaults`) | A filled rounded rectangle, or with `kind: "triangle"` a triangle that fills its `w × h` box pointing right (rotate the element for another direction; `radius` is ignored), drawn with `Graphics`, anchored top left. With `kind: "arc"` a stroke on the circle inscribed in the box, `min(w, h) − strokeWidth` across and centred, so the stroke stays inside the box: from 12 o'clock clockwise over `sweep` of the circle (clamped to 0..1; 0 draws nothing and leaves the build, 1 is a closed ring with no ends), ended by `cap` (`"round"` or `"butt"`), in `stroke`, `strokeWidth` and `alpha`; `sweep` and `cap` are optional: only an arc reads them; a rectangle or a triangle ignores them. It is stroked in segments as many as its angle needs (48 for a ring). An arc draws no fill and ignores `radius` and `dash`; its `clip` masks the children to its box. `fillAlpha` is the alpha of the fill alone: `0` draws only the stroke, a ring. `alpha` fades the whole shape and the entity's children (see the alpha rule under "Layers, sort and lift"). `dash` above 0 dashes the stroke: dashes of `dash` reference units, gaps of half a dash, walking the straight edges and the rounded corners sampled as arcs (`sync/shape-path.ts`). `clip: true` masks the children of the entity to the shape, never the shape itself, so its stroke is drawn whole; the mask is always filled and never dashed. The path is built again only when a field it is drawn from changed: a still arc costs nothing a frame, a new `sweep` builds it once, a new `fill` does not build it. Motions tween only the numeric fields (`sweep` among them), never `kind` or `cap`. |

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

The drawing resolution has four sources and one rule: `override ?? min(devicePixelRatio, maxResolution) × scale`.

- `devicePixelRatio` is followed in every build: a `matchMedia("(resolution: <dpr>dppx)")` query,
  armed again for the new ratio after every change, so a window moved to a screen of another ratio,
  or a browser zoom, draws sharp from the next frame. No window or no `matchMedia`: nothing is armed.
- `maxResolution` is a number of the config (memory grows with its square).
- `scale` is the render scale of the adaptive frame rate (`time.adaptive` on, `adaptiveScale` of the config): 1, or
  on a GPU-bound screen 0.85, then 0.75, down to the floor, before the frame rate drops. `time:rate` carries it; the
  renderer draws at it from the next frame, reason `"rate"`. The default, `{ floor: 0.75, devices: "phone" }`, applies
  on a phone only (a coarse pointer and a short side of at most 820 CSS px, read at start), so a phone at resolution 2
  draws the memory screen at 1.5 before it drops to 60 fps. Every change redraws the canvas and retakes each kept
  picture once; the rule holds a lower scale at least twice its dwell, so a picture never goes live from it.
- `app.renderer.monitor.setResolution(n)` overrides them all, in every build: a player's graphics
  setting is applied by it from an effect, and the A/B runs of a debug build switch with it.
  `undefined` hands the choice back. Outside 0.5 to 4 it throws a `RangeError`. While it holds the
  adaptive frame rate gets no scale (`time.allowScale(1)`); after it, the floor again.

Every change goes through one mechanism: it is remembered, and the next frame applies it on the
resize path (`viewport` lays out, `host.resize(w, h)` calls Pixi's `renderer.resize(w, h, r)`), so
a burst of changes costs one resize, the CSS size, the frame and the scale stay, only the backing
store changes. A restore after a lost device comes back at the current target, override
included. `host.onResolution(fn)` (internal) hears every applied change with `(from, to, reason)`, the reason
`"dpr"`, `"setting"`, `"debug"` or `"rate"`;
the monitor writes it into the log, and B1, F12, C14 and PX1 subscribe in later blocks.

### `viewport` — `app.renderer.viewport`

| Method | Behaviour |
|---|---|
| `toReference(clientX, clientY)` | `(client − canvas rect − frame offset) / scale`. The rectangle is read at call time. Inert: the input unchanged. |
| `toScreen({ x, y })` | The inverse: reference units to client CSS pixels, `canvas rect + frame offset + point × scale`. The `game.locate` source places an element or a view on the page with it. Inert: the same numbers, a fresh object. |
| `size()` | Reference units, one frozen object, replaced only when the frame changes (a resize, a rotation, new insets, a new scale); compare with `===`, and never write into it: a write throws. A layout that gives the same frame (the observer's first echo, a resolution change with the same CSS size) keeps the object. `scale = min(short / referenceSide, (long − safe insets) / referenceLong)`: the short side is at least `referenceSide` and grows on a wide screen, the long side inside the safe area is at least `referenceLong`. Inert: the `aspect.min` frame, `scale: 1`, zero safe area, one frozen object too. |

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
| `loopsHeld(entity, reveals?)` | The seam of `anim`: whether an endless loop of the entity writes nothing now: its view lies under an opaque cover or in a blurred kept picture of an overlay, or nobody sees it (it or a view above it is at alpha 0, or it is a leaf wholly off the screen). `reveals` says what the loop writes that could show the view again (`"alpha"`, `"place"`, `"both"`): such a loop is not held for its own alpha 0 or for being off the screen. Its clock runs on. Inert, and without a view: `false`. See "What is not drawn". |
| `debug.overlays()` | Every overlay, bottom first: `{ entity, label, phase, mode, level, range, kept }`, a fresh array; `[]` with none. |
| `debug.nineSlice(on)` | Outlines every nine-slice (next pass). A nine-slice with its own `debug: true` keeps its outline while the switch is off. Works while inert. |
| `debug.overdraw(on)` | Dev and debug builds: draws every frame as the overdraw heat map (see "Overdraw heat map"); off draws the game again from the next frame. Elsewhere the switch stays off. |
| `debug.state()` | `{ nineSlice, verifyFrames, kept, overdraw }`, a fresh object. |
| `filters.set(entity, slots)` | The filters drawn on the entity's view, in order: `slots` is `{ filter, passes }[]`, a Pixi filter instance `effects` built and the render passes one apply costs; `[]` clears. See "Filters". Works while inert: stored, nothing applied. |
| `filters.area(entity, area)` | The rectangle `[x, y, width, height]`, in the entity's own units, outside of which the view's filters draw nothing; `undefined` goes back to the view's bounds. Kept per entity like its filters. See "Filter area". |
| `filters.warm(filter)` | Creates the GPU pipelines of a filter before a screen needs them: drawn invisibly before a frame, in every target (see "Pipeline warm-up"). Answers `true` once drawn, `false` at once with nothing to warm (no device, headless, `warm: 0`), and `false` when the renderer stops first or a probe's render threw. Never destroys the filter. |
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
instances differ from what the target holds. Pixi is handed only the enabled filters of a view, and none when all of
them are disabled: a filter Pixi holds is pushed and popped around its view every frame, two batch breaks, even
switched off (a button's press dim waits switched off). A filter switched on or off is handed over again by the draw
callback's first step (`sync.stepFilters`), before anything reads the tree, so the switch is drawn in the frame it was
made; uniform writes and `enabled` flips need no call. The render passes and the kept pictures read the slots, enabled
or not, as before.

The filters come off the object and its wrapper when the view lets its object go: a pooled sprite
never carries one into its next life, and a `Display` object leaves without them, on despawn as at
stop. The entry is forgotten when the entity despawned, read with `ecs.ownerOf` in the pass where its
visual left, and when the renderer stops. Each pass also sweeps the entries of entities that have
no view and whose `ecs.ownerOf` is `undefined`, so an entity that despawned after its visual had
already left is forgotten too. A live entity keeps its filters for its next visual, in
the same frame (a `ui` element that trades its shape for a nine-slice keeps its glow) or later. A `rebuildAll` after a restore applies them again. The renderer never destroys a filter.

### Filter area

`filters.area(entity, [x, y, width, height])` (spec 27 B4) sets the rectangle outside of which the
view's filters draw nothing, in the entity's own units; `effects` hands it the union of the areas its
enabled filters declare (`defineFilter(id, { area })`). Pixi then sizes the filter's textures and its
fill to that rectangle, transformed by the view's world transform, instead of the view's bounds: a
lens that shows a 176 × 176 disc on a full-screen cover fills 0.24 MPx, not 1.67–2.5. Outside it Pixi
draws nothing of the view at all, neither the filter nor the view's own content.

The area is kept per entity like the filters (a view built later, pooled or rebuilt gets it again;
it is forgotten when the entity despawns) and written into one Pixi `Rectangle` per entity, in
place, as the `filterArea` of the view's top (`view.wrapper ?? view.object`), in the top's own
units: without a wrapper the visual's stretch (`drawScale`) is folded into the object's scale, so
the numbers are divided by it; a wrapper carries the pose alone. The entity is marked before every
write, and nothing is written when the top already holds the same four numbers. It moves to a
wrapper made later, follows a new stretch of a sprite, and comes off with the filters when the view
lets its object go. While a view is drawn from its kept picture its filters hang on the picture's
stand-in, which draws without an area (the kept output covers the view's bounds: the same pixels,
by the area's contract); the top keeps it, inert, until the filters come back. The pass count is
unchanged: an area changes the size of the passes, not their number.

### Pipeline warm-up

WebGPU creates a pipeline at the first draw that needs it, inside the frame, and keys it by the
bound target (its formats and stencil state), the geometry layout, the program and the blend. The
measured cost on the phone was a 283 ms splash frame and a 33 ms first shop. The renderer creates
them while the game loads (spec 27 F4): a drawn frame first draws `renderer.warm` invisible probe
draws (default 1), then the kept pictures, then the stage pass, which clears the canvas, in the same
task, so a probe never shows. One probe draw is one subject in one target:

- the subjects: a 4 × 4 sprite of `Texture.WHITE` (the batch pipeline of sprites, nine-slices and
  plain bitmap text), a `Graphics` with `batchMode: "no-batch"`, a `ParticleContainer` with the
  normal and the add blend, a `BitmapText` in the first font installed (queued when it arrives,
  ahead of the filters still waiting), and every filter handed to `filters.warm` (`effects` hands it
  every checked definition, every stage of its inputs and every Pixi-core kind once the shader
  checks settled);
- the targets on WebGPU: the canvas and a texture (a 4 × 4 render texture the module owns, cleared
  at each draw), each with and without a stencil clip, as `sync` hangs clips; on WebGL one draw, the
  program does not depend on the target. A canvas the stage pass does not clear
  (`background.clearBeforeRender` false) gets the texture targets alone (`renderer:warm-canvas-off`,
  once).
- a filter probe is the one filter of its render: a texture draw renders into the module's texture,
  never through a filter of its own, so the warm-up never opens a second level of Pixi's filter
  stack. Pixi 8.21 reads the input texture of such a level as it last left it at its next push, and a
  pool trim destroys that texture in between: the push throws inside Pixi's render, and the stack it
  leaves unbalanced breaks every filter of the frames after it.

The probes hang in a tree of their own, never in the stage, and only during their own render. The
queue asks `demand` for the next frame (`"request"`), so a renderer drawing on demand draws through
it; a draw is counted only after its render call ran in a drawn frame. A probe whose render throws
ends the warm-up of the application: Pixi's filter stack may be left unbalanced, which no public API
rebalances, so no probe is drawn after it. It is logged once at error level (`renderer:warm-failed`
with `subject`, `variant`, `error` and, for a filter, `filter`: its program's name or its class),
every waiting promise answers `false` and its filter is forgotten (its caller may destroy it); a
new application after a restore warms again. A Pixi that cannot build the probe tree ends the
warm-up of the device too (`renderer:warm-failed`, `subject: "probes"`, a warning: nothing was
drawn). A frame that drew probes is told to `time` with `frameProbed()`: it
is drawn but never a sample of the adaptive rate. A restore queues everything again on the new
device; `onStop` answers waiting promises `false` and destroys the probe tree, never a filter it was
handed. In an agent build the end of a run writes a `warm` event line (`{ draws }`); a run a throw ended writes none. Not warmed: a
game's own `Display` objects with custom shaders (hand their filters to `filters.warm`; their
meshes are not covered), blend modes other than normal and add, MSAA. `renderer.warm: 0` turns it
off: every pipeline is created in the first frame that draws with it, as before.

### `invalidate` — `app.renderer.invalidate(entity)`

| Method | Behaviour |
|---|---|
| `invalidate(entity)` | Tells the renderer, **before** the write, that the Pixi object of an entity's view is about to change in a way it cannot see: a game's own `Display` object, a filter value of `effects`, a particle step. With `onDemand` the frame is drawn when the view was or will be seen (see "Render on demand"); without it nothing changes. No whole-frame form: whole frames come from the renderer's own reasons. Inert, and for an entity without a view: a no-op. |

### `monitor` — `app.renderer.stats()`, `app.renderer.capture()`, `app.renderer.monitor`

| Method | Behaviour |
|---|---|
| `stats()` | `{ fps, drawn, frameMs, textures, textureMb, textureMbSplit, views, pooled, renderPasses, renderPassesMax, kept }`, plus `drawCalls`, `redraws` and `rebuilds` in a dev or debug build, and `counts` (the live object counts, see "Live object counts") in an agent build, a fresh object. Inert: all 0, `kept` `{ pictures: 0, mb: 0, retakes: 0 }`. |
| `monitor.stream(listener)` | Agent builds: the performance log, line by line (see "The log"). The unsubscribe; a second call does nothing. Without the flag the listener is never called. |
| `monitor.frames()` | The frame ring: typed-array columns written in place, the same object every call; `ring.read(into, cursor)` copies the new frames into the caller's arrays without allocating. Capacity 0 without the flag. |
| `monitor.mark(label)`, `monitor.event(name, detail?)` | Agent builds: a mark, an event at the frame it happens in (`scene`, `bundle`, `switch`, the editor's `command`, `recorder`, `devtools`, …). Nothing otherwise. |
| `monitor.beginAgent()`, `monitor.endAgent()` | For engine plugins and the editor's page agent. Agent builds: bracket the agent's own work, measured as the `agent` phase, left out of the spike rule and handed to `time.chargeAgent`. A nested begin and a lone end are ignored. |
| `monitor.setResolution(n \| undefined)` | Every build: draws at `n` from the next frame; `undefined` goes back to the policy (see "Resolution"). Answers the resolution of the next frame. |
| `monitor.counts.register(name, read)` | Agent builds: adds a count to the live object counts, read once a second (see "Live object counts"). A name registered again gets the new reader. At most 16: the 17th throws `[game] Monitor count table is full (16).` The remover; the renderer's `onStop` drops every count. Nothing kept without the flag. |
| `monitor.sections(next?)` | Agent builds: which sections of the monitor run (see "Sections"), one frozen `MonitorSections` until a switch. With `next` it switches the sections named, from the next frame on, and writes a `sections` event; a write needs control (a dev page or `--debug`): on a `--debug=read` page a switch that would change a section throws an `Error` with `reason: "read-only"`, and the sections stay. Without the flag every section answers on. |

`frameAt(ring, age)` (root export) turns one slot into a plain record: NaN as `null`, bits as
names, the path id as the flow path. A reader of the columns names the bits itself with two root exports:
`PERF_CAUSES[i]` is bit `1 << i` of `causes` (a gap spike after a compile reads 9, `["gap", "compile"]`), and
`DEMAND_REASONS[reason]` is the draw reason of `reason` (255: no decision). Both only ever grow at the end. `textureMbSplit` splits `textureMb` into the art a game loaded,
the render targets Pixi draws into, and the pictures the engine keeps (`host.keep`, from F12/C14).
| `capture(options?)` | Dev builds only. `{ png }`: a PNG data URL of the whole canvas, bars included, taken right after the next frame is drawn; at once while the clock is paused. `{ png, legend }` with `legend: true`. `undefined` in a production build, while inert, lost or unsupported, and when Pixi cannot read the frame (logged). Options: `legend`, `layers`, `sheet`, `against`; see "Capture". |

- `fps` counts the frames of the loop, drawn or not, over one second of `clock` time; 0 before the
  first full second and when no frame ran in the last second. A gap over one second, a pause or a
  hidden tab, restarts the window instead of reading as one slow frame.
- `drawn` counts the frames really drawn over the same second: equal to `fps` without `onDemand`,
  0 on a screen at rest with it. `drawCalls` is the count of the last drawn frame: a skipped frame
  keeps it.
- `redraws` (dev and debug builds) counts the `Graphics` paths the engine drew per second over the same window:
  shapes, clip masks, nine-slice outlines. A still screen draws none; a fill-only shape whose colour changes draws
  none (its colour is a tint). `rebuilds` counts the times Pixi rebuilt a render group's instruction list per second:
  a still screen rebuilds none, a fade to 0 and back rebuilds at its start and its end. The redraws are one integer
  increment in every build, taken by `end()`; the rebuilds come from a seventh counting class, a `BatcherPipe`
  subclass whose `buildStart` Pixi calls once per rebuild (see "Draw calls").
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
`beginRenderPass` inside a frame (the seven counting classes of a dev or debug build count it too; a
production build swaps the encoder alone, one boolean test and one typed-array increment per pass);
on WebGL the public runners count a bound target (count-only items in a production build). A frame
that is not drawn counts nothing and keeps the number of the last drawn frame; `renderPassesMax` is
the most of one drawn frame in the last full second, so the frame that took a picture shows there.
Where nothing counts (headless, a test stage, a fake application) both report the estimate below.

`sync.renderPasses()` is the estimate, computed from the filter slots `sync` holds, never asked of the GPU, at call time:
0 while inert; otherwise `1 + Σ over views drawn under the root with an enabled filter (1 + Σ passes of the
enabled slots)`; a view drawn from its kept picture costs nothing, nor does a view inside one or under any node that
is not drawn (an empty or alpha-0 view, a hidden layer: `visible` or `renderable` false up to the root), and the
passes the last flush of the kept pictures made are added (1 per subtree picture, 1 + the slots' passes per filter output, 1 per range picture). A filtered view costs one pass for its content and one per filter apply (spike
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
and the counter leaves the bundle; `stats()` then has no `drawCalls`, `redraws` or `rebuilds` field. The guard is the one of
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
scene, bundle, restore). The counting is seven subclasses swapped in through `extensions`
(`BatcherPipe`, `GpuBatchAdaptor`, `GpuGraphicsAdaptor`, `GpuEncoderSystem`, `FilterSystem`, `GpuTextureSystem`,
`GlTextureSystem`); on WebGL a pass is a bound target, seen on Pixi's public runners. Compiles are
counted on GPU objects of this application only: own properties on the engine's own device and
`linkProgram` on this app's WebGL context. A pass's kind is `canvas` for the canvas, `filter` while a filter applies,
`texture` otherwise (a kept picture's take); on WebGPU the canvas is the view's render target, kept at attach and
compared by identity, because Pixi 8.22 marks every WebGPU target `isRoot` when it first binds it. Long Animation
Frames come from a `PerformanceObserver`
(long tasks where the browser has no LoAF, none on WebKit), the heap from Chromium's
`performance.memory`. The per-frame path allocates nothing: indexed stores into typed arrays
allocated once; a dev-only probe (`monitor-alloc.test.ts`, under Node's heap sampler) checks it, and the `alloc` gates
of `__tests__/perf/` (`bun run test:perf`) check the frame, the sections and the sync pass in bytes per call.
`monitor/clock.ts` is the one renderer file that reads the page clock (lint L3 ignores it).

**The spike rule.** The budget of a frame is one frame of the rate the loop can reach (`monitor.budgetMs: "rate"`,
the default): `max(1000 / rate.fps, 1000 / displayHz)`, since a loop runs no faster than its panel. 8.33 ms at the
120 fps target on a 120 Hz panel, 16.7 ms at the 60 fps fallback, and 16.7 ms at the 120 fps target on a 60 Hz panel.
While `time` does not know the display yet (`FrameMeasure.displayMs` NaN), the display is guessed from the ticks: the
median of the last nine tick intervals of 50 ms or less (a frame's gap over the ticks it spans), snapped to a display
rate within 5 %; a median that matches none leaves the rate's budget. A number is a fixed line. The ring's `budgetMs`
column keeps the budget each frame was judged by. A frame is a spike when its gap, the agent's work left out, is over
`1.5 × max(budget, cap, the previous frame's cap)` (`gap`: the gap of a wake frame is an interval of the idle cap),
when its work, the agent's left out, is over the budget (`js`), or when its GPU time lands over the budget (`gpu`).
With `budgetMs: 16.7`: a gap of 25.0 ms is no spike, 25.1 ms is; at the idle cap of 30 fps the line is 50 ms, also
for the frame that wakes. A gap that says nothing is not judged: on a hidden page, on a throttled one (this gap and
the previous one over 500 ms, with work under half the budget), and between two frames that drew nothing (the ticks
of a still screen); the frame that draws again is judged. A spike is annotated with `compile` (a compile in the frame
or, for a gap spike, in one of the 4 frames before it: the stall comes after the compile), `upload` (1 MB or more),
`longFrame` (an overlapping Long Animation Frame) and the hint `gc?` (a gap of 500 ms at most with work under half the
budget, after the heap dropped by 0.5 MB or more: Chromium only, a hint, never a certainty). A stepped frame is never
a spike. A sample's `gaps.missed` counts the frames with the `gap` cause: the same line and the same exceptions, one
rule for both (a 120 fps loop on a 60 Hz panel misses none).

#### Sections

The monitor's per-frame work is eight sections (`MONITOR_SECTIONS`, root export; the names of the editor's contract),
each on unless `renderer.monitor.sections` or `monitor.sections({ … })` switches it off: `gpu` (the GPU timer),
`passes` (the pass ring and its stencil count, and the draws, filter applies, uploads, instruction rebuilds and render
targets the counting classes count), `shaders` (the pipeline compiles and shader modules), `problems` (the problem
rules' accumulators and their judgment), `memory` (the heap read of every frame and its `gc?` hint), `systems` (the time
of every world system), `nodes` (the change marks of the frame and its draw reason) and `longFrames` (the long frames the
browser reports). A section off skips its part of the commit and its counting increments (one bit test each); its ring
columns read NaN and its sample fields `null`, as on a build that cannot measure them, and while `passes` is off
`stats().drawCalls` and `rebuilds` read 0. The header's `sections` is the object `monitor.sections()` answers, so a
switched-off section differs from one `measured` does not list; a `sections` event names the sections `{ on, off }`.
Every `sample` carries `sectionsMs`: the page-clock ms of the second each section's part of the commits took, 0 for one
that is off, and `base`, the rest of the commits; a commit reads the clock once per section that runs. Pixi-side
counting is not timed. An Android WebView's clock is coarse, 0.1 ms: a part shorter than that adds 0 or 0.1 ms at a
time, so read the sum over the second, never a single frame.

#### The log

`monitor.stream(listener)` hands a listener one JSON object per line, every one with `v: 1`
(`PERF_LOG_VERSION`), `kind`, `t` (page epoch ms, `performance.timeOrigin + performance.now()`) and
`build` (spec 10's build id, `null` on a page without one). Every line is a fresh object, frozen all
the way down: a listener may keep it. A reader skips a kind or a field it does not know; "not
measured on this build or backend" is `null`, never 0.

| Kind | When |
|---|---|
| `header` | At once to each new subscriber: the device (model from the native shell, else the user agent; `webview` the Chrome major of an Android WebView, `; wv)` in the user agent, or of the page in the native shell, else `null`; `browser` the Chrome major of any Chromium page), the GPU and its timer, the display, the shell's thermal reading, the loop's frame rate (`rate`, `time.rate()`), the config (`budgetMs`: the newest frame's budget), what is measured (`targets` where render targets are counted), the app id (`app: { id }`, `__MOKU_GAME_APP__`: `"com.mokulabs.timber.debug"` in a native debug build, `null` without one), the debug drawing (`debug: { overdraw }`) and the sections of the monitor (`sections`, as `monitor.sections()` answers them). On the native shell it waits for `__MOKU_NATIVE__.ready`, 500 ms at most. |
| `startup` | Once, at the first flush after the first drawn frame, and to every later subscriber after its header: HTML, the bundle's download, parse, evaluate, the Pixi chunk, `app.init`, the first frame, the boot long frames. |
| `sample` | Once a second of page clock (and on a pause, for the partial second): counts, gaps with their histogram (`PERF_GAP_BUCKETS`), work, phases, systems, GPU time, passes, draws, filters, uploads, compiles, long frames, heap, textures, what measuring cost, the live object counts (`counts`), the render targets made and dropped (`targets: { created, destroyed }`, WebGPU; `null` elsewhere; not the memory of `textures.targets`) and what each section of the monitor cost (`sectionsMs`, see "Sections"). |
| `spike` | At a flush, once its GPU time landed or a flush later: the frame's record, systems, compiles, filters per kind, passes with GPU time, kind and label and their detail (see "Pass detail"), the long frames around it. |
| `longFrame` | When the observer delivers one. |
| `event` | As it happens: `resolution`, `device-lost`, `device-restored`, `pause`, `resume`, `display` (a resize, a restore, a turn, or a display rate `time` learned: the `PerfDisplay` of the moment, with `hz`, `time.rate().displayHz` or `null`), `compile`/`upload` (at a flush), `shader` and `problem` (at a flush, see below), `debug` (`{ overdraw }`, when the overdraw switch moves), `sections` (`{ on, off }`, when a switch changes them), `rate` (every `time:rate`, the payload as its detail), `scale` (a `time:rate` that moved the render scale: `{ from, to, reason, fps }`), and every `monitor.event` call. |
| `mark` | `monitor.mark(label)`, and an auto mark when the flow rests on a new path. |
| `thermal` | Every `time:thermal` reading of the native shell. |

The engine sends nothing anywhere: the listener decides (the editor's page agent posts the lines to
its collector). Without a listener no line is built; the ring records anyway. The editor's collector
writes two kinds of its own into its copy of a log, `gap` (lines a device lost) and `telemetry` (wired
device telemetry); the engine never writes them (`PerfGapLine`, `PerfTelemetryLine`).

#### Pass detail

Each render pass of the pass ring (`frames().passes`, `capacity × 4` of them) carries, beside its
frame, index, kind (`PASS_KINDS[kind]`), stencil, size, GPU time and label:

| Column | What |
|---|---|
| `owner` | The entity whose filter drew the pass (sync notes it per Pixi filter in `filters.set`: the filter, the stages of its inputs and a blur's two pass filters); 0 for the canvas, a texture pass and a filter no view hangs. |
| `kind2` | The filter's kind, **1-based** into `frames().kindNames` (`kindNames[kind2 - 1]`, `"other"` first), 0 for none: the rule of the frame's `fltKind` column too. |
| `drawsAt` | The frame's draws when the pass began (WebGPU; draws are not counted on WebGL): a pass drew up to the next pass's `drawsAt`, the last one up to the frame's `draws`. |
| `format`, `resolution` | The target's texture format (by reference) and resolution; `null` / NaN when unknown. |

A spike's `passes[]` reads the same: `owner` and `view` (the owner's view label when the line is
built), `filter` (the kind id), `draws` (`null` where draws are not counted; they add up to the
frame's draws), `format`, `resolution`, and `kept: true` for the take of a kept picture (its label
starts with `kept:`). A filter chain is the passes of one owner in a row. `frames().systemNames` names
`sysIdx`; a world that registers a system makes a new array, so a reader sees the growth by identity.

#### Shader events

Every pipeline the engine's device creates (WebGPU) or program it links (WebGL), and every WebGPU
shader module, is kept in a ring of 64 records with its frame, label, CPU time and where it happened:
the index of the pass of the frame, and the filter kind and its owner while a filter applies (a
compile of a plain batch has none). At each flush with a listener, every record not sent yet becomes
one `shader` event, `ShaderEventDetail`: `{ what: "compile" | "module", label, ms, frame, boot,
during: { pass, filter, owner, view } }`, `boot: true` up to the first drawn frame (a listener that
comes after the boot still gets the records the ring holds). `SHADER_WHATS` lists the values of `what`;
`variant` and `relink` come later. The `compile { frame, count }` event stays as it was.

#### Problems

Once a second the flush judges three rules from accumulators the frames fill without allocating, and
writes a `problem` event once per crossing (`ProblemEventDetail`, rules `PROBLEM_RULES`): `{ rule,
severity, owner, view, filter, value, threshold, since, frames, reason? }`, and `{ rule, cleared: true,
owner, view }` when the condition stops.

| Rule | When | `value` |
|---|---|---|
| `filter-still` (warn) | A filtered view whose kept record is live while kept pictures are on stood still (no stage-1 change) for `stillFrames` drawn frames, its filter applied in every one of them over `stillMpx` a frame. `reason: "budget"` when its take was refused for the kept budget, `"not-eligible"` otherwise. A view without a kept record (a filter that reads the screen) is not judged. | Still frames |
| `target-churn` (warn) | Render targets made and dropped `churnPerSecond` a second for `churnSeconds` seconds in a row (`reason: "rate"`), a target made in an idle frame (`"idle"`), or made within `churnAfterTrimMs` after a pool trim (`"after-trim"`). WebGPU. | Targets made and dropped in the second |
| `retakes` (info) | A kept view taken again 3 times or more in 2 seconds, its first take left out. | Takes per second |

#### Live object counts

The leak detector of a debug build: `sample.counts` and `stats().counts` read, once a second and at
call time, `entities` (`world.ecs.count()`), `views` (the views of `sync`), `timers`
(`clock.pending()`), `frameListeners` (`time.onFrame` callbacks) and `clockListeners`
(`clock.onElapsed` listeners), and every count a plugin registered with `monitor.counts.register`:
`input`, which depends on the renderer and cannot be read by it, registers `inputListeners` in
`onStart`. A screen entered and left brings every count back to where it was; a count that grows by
one a visit is a listener or a timer the screen leaves behind.

#### Overdraw heat map

`sync.debug.overdraw(true)` (or the door `game.debug { overdraw: true }`) draws every frame so that a
pixel's brightness counts the layers drawn there: 1/16 white a layer, white at sixteen and more. Only
the stage pass changes: right before it every node under the root blends `"add-npm"` (alpha adds up),
every layer draws at alpha 1/16 and every node under it at 1 (0 stays 0), filters are off, kept pictures
draw live (`kept.live`: every record bypassed, the entries of every range picture lifted), and one
`ColorMatrixFilter` on the root turns the frame's alpha into grey; right after it every node gets its
own alpha, blend mode and filters back. Between frames the tree is the game's, so the oracles, a
capture and the editor read the game, and off draws it again from the next frame. While on, every frame
is asked for, also with `onDemand`. A texel a texture leaves transparent adds nothing; outside the
root's bounds the background shows. Public Pixi API only. The frames are marked in the log (`debug`
event, `header.debug.overdraw`). Dev and debug builds only. The browser leg
`bun tests/visual/overdraw.visual.ts` checks it on the GPU.

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
  `game.capture` with `diff` writes the state, so on a `--debug=read` page it throws `controlReadOnly`. The dev branch logs `"moku:dev"`
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
| `rootPoseInto(ecs, entity, out, own?)` | The same pose written into `out` (its `pivot` object too) and answered: no object of its own, for a reader that asks every frame (`effects`' following emitters). |
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
| `preference` | `"webgpu" \| "webgl"` | `"webgpu"` | Passed to Pixi. Pixi falls back to WebGL by itself. A game whose features bring a backdrop filter (`defineFilter({ backdrop: true })`) also gets Pixi's `useBackBuffer`: on WebGL every frame is drawn into a back buffer and copied to the canvas, which such a filter reads under its view; WebGPU ignores it. |
| `aspect` | `{ min, max }` | `{ 4 / 3, 21 / 9 }` | Allowed long side / short side. A window outside it gets bars. |
| `poolLimit` | `number` | `256` | Display objects kept in all pools together. |
| `unsupportedMessage` | `string` | `"This device cannot run the game."` | Text of the unsupported-device screen. |
| `loadPixi` | `() => Promise<PixiModule>` | `() => import("pixi.js")` | Loader seam. Tests pass a fake module. |
| `debug` | `{ nineSlice?, verifyFrames?, kept?, overdraw? }` | `{ nineSlice: false, verifyFrames: false, kept: true, overdraw: false }` | Debug drawing and checks at start, a switch left out is off (`kept` left out is on); `sync.debug.nineSlice(on)`, `sync.debug.verifyFrames(on)`, `sync.debug.kept(on)` and `sync.debug.overdraw(on)` switch them at run time. `verifyFrames` and `overdraw` work in dev and debug builds only. |
| `onDemand` | `boolean` | `false` | Draw a frame only when something on the screen changed (see "Render on demand"). Off: every frame is drawn, as before. |
| `monitor` | `{ budgetMs, frames, stillFrames?, stillMpx?, churnPerSecond?, churnSeconds?, churnAfterTrimMs?, sections? }` | `{ budgetMs: "rate", frames: 1024, stillFrames: 60, stillMpx: 0.25, churnPerSecond: 4, churnSeconds: 3, churnAfterTrimMs: 1000 }` | Agent builds: a frame over `budgetMs` is a spike (`"rate"`: one frame of the rate the loop can reach, the frame's rate or the display's when slower, 8.33 ms at 120 fps on a 120 Hz panel, 16.7 ms at 60 or on a 60 Hz panel); the ring keeps `frames` (64 to 16384), render passes 4x as many. The other keys are the thresholds of the `problem` rules (see "Problems") and `sections`, the sections a debug build starts with (see "Sections"); a key left out keeps its default, a section left out is on. |
| `keptMb` | `number` | `64` | MiB the kept pictures may hold (see "Kept pictures"); the least recently drawn goes first when it is full. `0` keeps none. Not a finite number of at least 0 throws at `createApp`. |
| `poolTrim` | `{ restMs, aboveMb } \| false` | `{ restMs: 1000, aboveMb: 16 }` | Gives back the render targets Pixi's pool keeps between frames: at rest, after a scene change, on a pause (see "Render targets and memory"). `false` keeps them until the app stops. Neither `false` nor two finite numbers of at least 0 throws at `createApp`. |
| `warm` | `number` | `1` | Probe draws per drawn frame that create the GPU pipelines the game will need while it loads (see "Pipeline warm-up"). `0` turns the warm-up off. Not a whole number from 0 to 16 throws at `createApp`. |
| `adaptiveScale` | `{ floor, devices } \| false` | `{ floor: 0.75, devices: "phone" }` | The render scale of the adaptive frame rate on a GPU-bound screen (see "Resolution"): the steps 1, 0.85, 0.75, 0.6 and 0.5 down to `floor` (one of them; 1 allows none), on `"phone"` only or on `"all"` devices. Needs `time.adaptive`. `false` keeps the resolution. Shallow merge: a game that sets it gives both fields. Anything else throws at `createApp`. |

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
| `render` | A pending resize is applied, then the overlay step (spec 22), then `kept` reads the marks, `demand` decides whether the frame is drawn; a drawn frame renders the kept pictures first (`kept.flush`), then `app.renderer.render(app.stage)` when `ready`, then the pixel leg of the kept oracle; then `demand` settles it (the dev check, the pixel check) and `monitor` closes the frame, its draw count and its pass count and hands a drawn one to the `capture()` calls due on it; last, `host` trims Pixi's texture pool when a rest or a scene change is due (see "Render targets and memory"). |

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

## Render targets and memory

Pixi keeps every render target a filter pass asked for (one per filtered container, one ping-pong
texture per chain of two or more filters, a blur's passes) in its one global `TexturePool`, idle
between frames, until the page closes: Pixi's own garbage collector never frees a pooled texture, and
a power-of-two bucket lives forever. After a walk through every screen of a game that is tens of MiB
(about 90 MB of the 202 MB of GPU textures of A Memory Missing on a Galaxy A26).

The renderer gives them back with Pixi's public `TexturePool.clear(true)`, strictly between frames
(after `host.render()` returned, or from a hook outside the render phase), never inside a frame and
never while the host is not ready or restores a lost device:

| Trim | When | Floor |
|---|---|---|
| rest | the screen drew nothing for `restMs` (`onDemand`'s skipped frames), once per rest | the targets grew by `aboveMb` MiB since the last trim |
| scene | `restMs` after a scene change (a new layer list from the scene), also while every frame is drawn; a second change moves the moment | `aboveMb` |
| pause | `lifecycle:changed` with `paused` (the page in the background, a game's `pause()`) | none: whatever grew goes |

`poolTrim: { restMs: 1000, aboveMb: 16 }` by default. One second is a screen the player reads, not
the gap between two taps, and spec 21's settle time at start. 16 MiB is about one screen's working set
at the shipping resolution (a full-screen target on the A26 at resolution 2 is 4.9 MiB, a frost's
three passes ~15 MiB): a still shop keeps its own targets, so its taps never re-allocate. A rest or a
scene change judged not worth it is not looked at again until the next one. `poolTrim: false` never
touches the pool: exactly the behaviour before. `stats().textureMb` and `textureMbSplit.targets` show
the drop; every trim logs `renderer:pool-trim` (debug) with its reason and the MiB freed, and an agent
build writes a `pool-trim` event line (`{ reason, freedMb }`).

What a trim costs: the next drawn frame that applies a filter takes new targets, only the ones it
uses (one per filtered container on its stack, `effects.maxPasses` caps the applies). A render target
has no upload (a texture, a view and a bind group on WebGPU; a texture and a framebuffer on WebGL) and
pipelines are keyed by format, so no shader recompiles. It lands on a frame after a rest, a second
after a scene change, or after a resume, never on a running motion.

What a trim never touches: a texture handed out and not yet returned survives and is destroyed when it
comes back (`cacheAsTexture`, canvas `Text`); the kept pictures are engine-owned `RenderTexture`s
registered with `host.keep`, never taken from the pool; art is never pooled. A trim draws no frame and
skips none: it changes no pixel.

With `time: { idleFps: 0 }` the loop itself stops at rest: the rest trim waits for the next frame of
the loop (the next wake); the pause and the scene rules still apply. The pool is module-global: two
apps on one page (the editor's preview and a test page) trim each other's idle targets, and each takes
new ones at its next filtered frame. The renderer does not clear the pool on stop, since another app
may be drawing.

## Kept pictures

A view whose filters allow it is kept as a picture while nothing it depends on changes: its subtree is
rendered once into an engine-owned texture (stage 1, `kept:<label>#1`), the pre-pass of its first
enabled filter with inputs runs once over that picture into engine-owned targets (stage 2,
`#2.<k>`, spec 24's `FilterSlotInputs`), and the filter stack runs once over both into a third
texture (stage 3, `#3`). The stage pass then draws one sprite, the quad, in the view's place, while
the view itself is hidden (`renderable = false`, reason `"kept"` of `sync/hidden.ts`, swapped
without a mark: both draw the same pixels). Every render happens in a flush before the stage pass,
so the canvas stays one pass. In a drawn frame with no mark and no whole-frame reason (a calm frame) a kept record
that owes nothing (no retake, no refresh, no settle, no churn to reset) is drawn from its picture as it stands, without
its step. A picture's render makes the top a render group while it is kept; a
top drawn live again stops being one (drawn with its filters inside a parent's filter pass, a render
group draws other pixels than the container did: found by the browser leg), and the colour of its
subtree is worked out again: Pixi's `disableRenderGroup` leaves the children with the colour they had
inside the group, without the top's own alpha and tint, so a top at alpha 0.5 would draw its subtree
at 1 (an alpha written away and back through Pixi's setter flags it). On by default
(`renderer.keptMb: 64`); `keptMb: 0` turns it off and the renderer draws as before.

The root of a picture's render is always a plain `Container` (spec 23 D4). A bare view (a sprite, a
nine-slice, a shape or a game's own view that draws itself, without children) gets its wrapper just
before its first take, the way a parent does: the pose, the filters, the filter area and a built-in
visual's alpha move up to the wrapper, and the visual inside keeps its stretch and its tint. A view
that draws itself made the root of a render group draws other pixels than live: Pixi's sprite pipe
keeps the group transform it cached before, so a sprite landed outside its picture (an empty
picture), and the root's own tint and alpha were applied twice. The wrapper carries the view's own
label, so the pictures and their passes still name the view, and it is made without a mark (it draws
the same pixels): no extra frame, no retake. It stays with the view until the view leaves, also
while the view is drawn live, so a view that pulses wraps once. A filtered view that never stands
still gets none. A visual that blends otherwise than normally keeps its view live, as a top does.

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
only the range drawn, shown by a sprite placed before the overlay, kept in the same budget. A kept
view inside a range that switches between its picture and live takes the range's picture again in
the same flush.

## Overlays and the HUD

A game marks the view an overlay is drawn from with `Overlay({ dim, dimColor, cover, hud, fade })`
in its `components`, and tags the views of its HUD with `HudPart({ key })`. A scene declares its HUD
layer with `{ above: "overlays" }` (`scenes`). `Overlay`, `HudPart` and `OverlayLevel` are engine
component names: a game component of the same name is the kernel's duplicate-name error. Only an
element `ui` owns is honoured.

```tsx
// The shop: its root is the overlay; the sheet above the dim is its child and stays live.
<stack key="shopDimLayer" components={[Overlay({ dim: 0.56, dimColor: 0x1b1430, hud: ["energy", "gems"], fade: 270 })]}>
  <button key="shopDim" intent="close" escape style={fullScreen} />
  <panel key="shopSheet" motion={sheetRise}>…</panel>
</stack>
// The case file: opaque once it has faded in.
<panel key="caseSheet" motion={sheetFade} components={[Overlay({ cover: "opaque" })]} />
```

**The range.** Everything drawn before the overlay's root is its range: the layers below its layer,
then the roots of its layer that draw under it (by `zIndex`, then insertion), bottom first:

```
scene layer      ← range
ui:  board root  ← range
ui:  dim         ← the engine's quad, right under the root
ui:  shop root   ← the overlay and its children, live
ui:  roots above ← live
hud layer        ← live, never in a picture
```

**The three modes.** `freeze` (any overlay, and an opaque one on its way in): the range is drawn as
one picture taken in the overlay's first frame. `cover` (`cover: "opaque"`, landed, not leaving and
drawn at alpha 1, an `AlphaFilter` included): the range is not drawn at all. `live`: an opaque
overlay from its first exit frame, so the scene is drawn again as the sheet leaves. One picture at a
time, the top overlay's: an overlay over an overlay keeps everything under the top one, the lower
overlay and its dim inside the picture; when the top one goes, the one below takes its own picture
in the same frame.

**Never stale for state (K1).** A kept picture is a cache: any change mark of a view in the range
(adapter marks included), a view that moves out of it or goes, a resize, a restore, the outline
switch, takes it again in the same frame, and that frame is drawn. A change above the overlay or in
the HUD takes nothing. A range that changes in three frames in a row is drawn live, and kept again
after eight calm frames. Endless loops are held only under an opaque cover or a blurred picture
(a filter with `blurs` on an entry or on a view in it that covers the viewport frame, so a window
wider or taller than the frame answers as the phone does; measured at every take, and in every
frame the fallback draws the range live, so a frost that comes on later is seen): they write nothing,
their phase follows time, and they write once in the frame after landing and after the first exit
frame, which takes the picture again with them. A blurred range the fallback draws live keeps its
loops held until its overlay leaves, so only a real change counts against the eight calm frames
(a frost that moved, a resize) and the picture comes back while the loops run on; the loops of a
sharp range are never held, and keep it live.

**A backdrop in the range.** A `backdrop: true` filter (effects README, "Backdrop") inside a range that is
shown as its picture runs no pass in a drawn frame: its view lies under a node `"freeze"` hides, so Pixi
copies nothing under it and runs neither its chain nor its composite. What it drew is in the picture: it runs
once in the frame the picture is taken, and again in a retake. A range drawn live (a sharp range whose loops
keep changing it, a refused picture) draws it in every frame, as any live view. In the frame the overlay is gone
and the range goes live, it is drawn again. `effects/__tests__/integration/backdrop-overlay.test.tsx` holds it.

**The dim** is the engine's: one quad of `dimColor` at `dim × level`, right under the overlay's
root, the size of the canvas; none under its own cover, gone with the overlay. A filter that painted
a glass tint under a panel draws it above the dim now, on the panel.

**Level and landing.** `level` goes from 0 to 1 with the overlay's root's own enter motion (its
longest timed track), and back to 0 with its exit motion; `fade` (default 250 ms) times it only when
the root plays none. `landed` turns true when the enter motion is over; leaving is the `Exiting` of
the root. Neither is a field of the marker: they are the engine's state (`OverlayLevel`, written by
`ui`), read through `app.renderer.sync.debug.overlays()`.

**HUD parts.** A part of the HUD layer is drawn at a factor the overlays give it, bottom first, each
overlay blending its keep (1 for `hud: "all"`, 0 for `"none"`, whether its list holds the key) by
its own level, written in the same step as the level: the top overlay decides. A part that is
leaving, or not fully back, takes no tap. A text part fades through a wrapper. A HUD view without
`HudPart` is never faded. `HudPart({ key })` and the `hud` list are typed by the game's `hud` keys
through `defineGame`.

**The one owner of `renderable`.** `sync/hidden.ts` is the only writer of Pixi's `renderable` in the
engine: a view is drawn when no reason (`empty`, `alpha`, `cover`, `freeze`, `kept`) holds. A game
never writes `renderable` on an engine view. The hit test never reads it: a view under a picture is
hit as before.

**Warnings** (dev, once per entity): `renderer:overlay-ignored` (a view `ui` does not own),
`renderer:overlay-above-hud` (an overlay in or above the HUD layer), `renderer:hud-part-outside` (a
`HudPart` outside the HUD layer), `renderer:overlay-value` (a value out of range, clamped). A refused
picture logs `renderer:overlay-live` at debug level and draws the range live. An agent build writes
the `overlay` event line (`OverlayEventDetail`: `what` ∈ `open`, `landed`, `leave`, `gone`, `live`,
`kept`).

`app.renderer.sync.debug.overlays()` reports every overlay, bottom first:
`[{ entity, label, phase: "shown", mode: "freeze", level: 1, range: 2, kept: true }]`.

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
layer its parent is in. The parent's own visual has depth −0.5, so a child at `Order` 0 or more
draws above it, a child at −1 or less below it, and a `ui` child at `zIndex` 0 (an `Order` between
−0.5 and 0) above it too. A layer container keeps its own sort rule.
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

### What is not drawn

An empty `Shape` (no stroke, and no fill alpha or no area: the `stack`, `row` and `column` boxes of `ui` without a
fill) and any built-in view or text at alpha 0 are not drawn, not measured and not filtered: the one owner of
`renderable` (`sync/hidden.ts`) hides them with the reasons `"empty"` and `"alpha"` (spec 26). An empty Shape hides
only its own `Graphics`: its children hang in its wrapper and its clip mask is a `Graphics` of its own, so both are
drawn; so a filter over a strip of empty boxes measures the strip, not the screen's corner. A built-in view (Sprite,
NineSlice, Shape) at alpha 0, the HUD factor of an overlay counted, hides its whole subtree; a text or another
adapter's object at alpha 0 hides only its own object, since its adapter writes its own alpha. Both stay hit-testable
as before: an empty box takes presses, an alpha below 0.01 does not. A view at alpha 0.005 is still drawn. A game
hides a view by alpha 0 and needs no flag; a `Display` object is the game's and is never hidden for its alpha. They
leave the bounds Pixi draws and filters with (the fast global bounds of a filter's area, the renderable bounds), so a
`Dim` over a strip of empty boxes measures the strip; Pixi 8.22's `Container.getBounds()` checks only `visible` and
still counts them. A pooled object comes back drawable and, for a `Graphics`, white: a fill-only shape is drawn white and coloured
by its tint, so a colour change rewrites the tint, never the path (a shape with a stroke is painted in its colours).

Endless loops of a view the player cannot see — at alpha 0, under a view at alpha 0, or a leaf wholly off the screen
— write nothing; their phase follows time (`sync.loopsHeld`, asked by `anim`). The walk of an entity is kept with the
`passesVersion` it was taken at and taken again only once the version moved: every write that can change where it
stops moves it (a pass that did work, a hidden reason, a filter set or switched, a HUD factor, a resize, an
`invalidate`), so the loops of a still board are answered without a walk. A walk reads whether a node is faded from the
engine's records (the `"alpha"` reason of a built-in visual or an adapter's object), not from Pixi's `alpha`, whose
getter boxes its double at every read; only a game's object and an adapter's wrapper are read from Pixi. A loop that
writes the view's own alpha or place keeps writing: it may bring the view back. In the frame a view comes back a held
loop shows its old phase once.

Removing `Parent` puts the view back in the layer its `Layer` names, at its own pose, in the same
pass: `world` records no change for a removed component, so `sync` watches `onRemoved(Parent)`.

A pass builds every parent before its child when both wait in it. A view whose `Parent` has no view
yet (its parent comes in a later pass, or carries no visual yet, or left and comes back) is an
orphan: detached and drawn nowhere, never in its layer while its parent waits. The pass that builds
the parent's view hangs every orphan of it at the end, placed and sorted there, so a view a game
hosts under a root spawned after it is drawn inside that root from the root's first frame, on start,
on a node entry, after a restore and after a lost device. `"renderer: parent draws nothing"` is
logged only for a parent that carries no visual component at all, once per orphan.

A dev or agent build checks the tree after every pass: every view the pass built, hung again or took
out of the orphans must hang under its parent's child container, or in its layer without a parent.
One that does not is logged once, `ctx.log.error("renderer:tree-mismatch", { entity, parent })`:
the hit test maps a point through the ECS `Parent` chain and finds its candidates in the Pixi tree,
so a mismatch is a press that misses. Read it first in the log of a debug build when a phone run
takes no input. A production build checks nothing.

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

Pixi 8.22 draws every distance-field (MSDF, SDF) bitmap label with a shader of its own: the custom shader of the
label's graphics context makes the context unbatchable, so every label is one draw through the graphics adaptor with a
uniform bind group of its own, and it breaks the batch around it (the A26 board: about 20 draws a frame, 538 KB/s of
garbage). Pixi's SDF shader also applies the alpha twice: its fragment step hands `calculateMSDFAlpha` the vertex
colour, which is premultiplied, the function raises `vColor.a × coverage` to a gamma that leans on the luma of the
premultiplied colour, and the template multiplies the result by `vColor` again. A label at alpha 0.5 drew at about
0.25.

The renderer draws distance-field text in a batch, through Pixi's public extension points, in every build. Three
pieces go into Pixi's extension registry before `new Application()` (`host/init.ts`, once per host state, swapped back
at stop), with the base classes' own `static extension` objects; no Pixi prototype and no Pixi instance is patched:

- **The text pipe** (`host/sdf-text.ts`), a subclass of `BitmapTextPipe`. `getSdfShader()` answers `null`, so Pixi
  gives the label's context no shader and it stays batchable. `initGpuText` sets the context's `batchMode` to
  `"batch"` (Pixi's `"auto"` gives a context of 50 glyphs or more up, and a context without a shader would then draw
  the glyph atlas as a plain texture) and keeps the edge of the label's glyphs on its proxy graphics under a symbol,
  one shape for every proxy: Pixi's distance at scale 1 (`range × fontSize / baseRenderedFontSize`, Pixi's own formula
  from `_updateDistanceField`), 0 for a font without a distance field. `addRenderable` and `updateRenderable` bring it
  up to date before Pixi's own; it is measured again only when the font family or size changes, so a text update
  makes no cache key.
- **The batcher** (`host/sdf-batcher.ts`), a subclass of Pixi's `Batcher` under the name `moku-sdf`: Pixi's default
  vertex (position, uv, colour, texture id and rounding) and one float more, the label's edge width; its geometry is
  Pixi's batch geometry with `aSdfDistance` after the texture id, 7 floats a vertex. Its packing is Pixi's
  `DefaultBatcher` loop with the distance written after the texture id: Pixi's distance at the label's scale in its
  render group (its group transform) times the renderer's resolution. Its shader is Pixi's five SDF bits with the local
  uniforms replaced by the renderer's piece, made once per batch texture limit and shared by every batcher: the vertex
  stage multiplies the distance by the scale of the render group's world transform, a global uniform, and the fragment
  step hands `calculateMSDFAlpha` the colour un-premultiplied at alpha 1,
  `vec4<f32>(vColor.rgb / max(vColor.a, 1e-4), 1.0)`, so the template's `outColor * vColor` applies every alpha once:
  the label's (`Text.alpha` is the alpha of its container), a parent's (a disabled button, a popup fade) and the
  world's. The shader reads bind groups 0 and 1 alone, the two Pixi's batch adaptor binds. On WebGL the GLSL twin of
  the same piece; Pixi compiles its batch programs as GLSL ES 1.00, so the distance is a plain varying there.
- **The batch pipe**, a subclass of `BatcherPipe`. `addToBatch` names an element's batcher before Pixi adds it: the
  glyphs of a distance-field label go to `moku-sdf`; a pooled element that carried that name before, now another
  graphics' or a plain font's, goes back to Pixi's `default`. `execute` packs the distances of an SDF batcher again,
  before Pixi binds its geometry, when the renderer's resolution changed since it last drew: two compares per batch
  run otherwise. The counting batch pipe of a dev or debug build extends this pipe (the plugin root hands it to
  `monitor`), and is installed after it, in its place.

Consecutive labels share one draw. Text never joins a batch of sprites: Pixi hands sprites to its default batcher by
name, so draws fall where labels follow each other in the draw order. A Pixi module without the pieces draws on with
its own pipes, with `ctx.log.warn`.

The edge is measured in device pixels (PX1): Pixi writes its distance in CSS pixels, while the shader spreads the glyph
edge over that many device pixels, so on a phone at resolution 2.8 the edge was smeared over three pixels. The
renderer's resolution is used, also for a label inside a filter or a kept picture of another resolution, as before the
batch. The scale of the edge is the label's world scale (K5): the label's scale in its render group, packed, times the
render group's own scale, read by the shader at the draw. A kept picture renders its view as a render group of its own
with the view's world transform, so its labels draw with the edges they have live, and a render group that scales (a
camera's, a popup's) needs no new vertices; a label whose view scaled is packed again by Pixi's own update of the
label. Inside a group cached as a texture, the group's own scale is used, the scale its texture is drawn at.

Measured on the mini and sheets visual legs and a fixture of labels (alpha 0.5, a tint with a faded parent, a
0.25-scaled render group and container, rotation, `roundPixels`, a filter, 60 glyphs, a cached group, a kept-like
render), WebGPU and WebGL, resolutions 2.8 and 1: every capture equal to the per-label shader's, except edge pixels of
the rotated label at 2.8 (at most 2/255 on WebGPU and 7/255 at one pixel on WebGL), where the glyph's corners are now
transformed on the CPU in doubles, as Pixi's batch does for every sprite. Ten consecutive labels draw in one batch where
they were ten graphics draws. Unit tests against the real module pin the names and members of the pieces, Pixi's batch
vertex layout, Pixi's coverage function and Pixi's distance formula, so a Pixi that moves them fails in CI.

### A cached group inside a filter

A game's `Display` object may cache a group as a texture (`cacheAsTexture`). Pixi 8.22's
`FilterSystem` binds a filter's input with `renderTarget.bind`, which is not on the target stack, and
`RenderGroupPipe` refreshes a cached group with `push` … `pop`: the pop binds the canvas, and what
the filter draws after it goes to the canvas (A Memory Missing's black memory screen). The renderer
installs a subclass of `RenderGroupPipe` the same way as the text pipe (`host/render-group.ts`, every
build, once per host state, swapped back at stop): around a refresh of a cached group it reads the
bind state (`getBindState`) and, when Pixi's pop left another surface bound, binds it again with no
clear. Nothing else changes; the engine never caches a group itself (its kept pictures are its own
textures). A unit test against the real module pins the bug: it fails the day Pixi restores the
bind itself, and the subclass may go. Reported upstream.

### The canvas pass on WebGPU

Pixi 8.22 begins the canvas's render pass when a render starts, with a clear and a store. A frame
whose first instruction is a filter ends that pass at once with no draw in it, and the filter's apply
begins it again with a load: on a tiled phone GPU (the Mali of a Galaxy A26) the memory screen paid
1.6 ms for that empty pass. And Pixi stores and reloads the canvas's depth-stencil attachment, which
the canvas has from its first stencil mask on, around every filter break. The renderer swaps Pixi's
WebGPU render target system and pipeline system for subclasses, the same way as the text pipe
(`host/render-pass.ts`, every build, once per host state, swapped back at stop; the stencil system is
registered again after them, as it subscribes to the render target system when it is made). No
encoder is swapped: the counting encoders count the passes that really begin.

- **The canvas pass begins at its first draw.** A bind of the canvas with no pass open on it begins
  nothing and keeps its clear owed; the first draw (the pipeline system is asked for a pipeline, a
  vertex buffer layout or a stencil mode before every command of a pass) begins the pass with that
  clear. A frame clears its canvas exactly once, in the pass that draws first. A read of the canvas (a
  backdrop filter's copy) pays the owed clear first. At the end of a render an owed clear is paid, and
  a canvas that saw no pass gets one, so a frame that draws nothing still clears and presents it. A
  canvas with multisampling is left to Pixi.
- **Stencil, the rule.** Pixi's masks count: a push draws the mask with `increment` where the stencil
  equals the depth of the mask stack, its pop draws it again with `decrement`, so with no mask open
  the stencil is 0 wherever a draw tests it. A canvas pass loads the stencil only while a mask is open
  on the canvas and clears it to 0 otherwise. It stores the stencil while a mask is open, or when a
  mask was pushed on the canvas in this frame or the one before; otherwise it discards it. A mask
  pushed into a pass that discards (the first mask after frames without one) begins the pass again
  first, the stencil cleared and stored, so a mask that spans a filter break never loses what it drew.
- **Depth, the rule.** Depth is read only by a pipeline that tests it and written only by one that
  writes it; Pixi's 2D pipes draw with `State.for2d()`, which does neither. Until a pipeline asks for
  either, the canvas clears and discards its depth. The first one begins the pass again (depth cleared,
  as nothing wrote it, and stored) and the canvas keeps its depth from then on; a copy of the canvas's
  depth does the same.

`stats().renderPasses` counts the passes that ran: a frame that opens with a filter now measures one
pass fewer than `sync.renderPasses()` estimates.

## Device loss and the hidden tab

| Step | WebGPU | WebGL |
|---|---|---|
| Detect | the `renderer.gpu.device.lost` promise | the canvas event `webglcontextlost`, with `preventDefault()` |
| On loss | `ready` false → `lifecycle.push("device-lost")` → `renderer:device-lost` | the same |
| Restore | destroy the application, init again, new canvas, then `viewport.apply` and `sync.rebuildAll()`; the next frame is drawn whole (`restore`) | Pixi restores on `webglcontextrestored`; the tree stands, but the canvas and every render texture came back empty, so the next frame is drawn whole (`restore`) and takes every kept picture and range picture again |
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
  draw-counting classes, in every build the bitmap text and render-group pipes and the lazy canvas
  pass's render target and pipeline systems, creates the
  application and appends the canvas; then, in the `onReady` callback, `viewport` creates the two safe-area probes, the
  two resize observers and the `moku-native:insets` listener, `sync` creates the root, the world hooks and the `renderer.sync` system, and the
  `render` frame callback is registered, and the warm-up queues its probes; in an agent build the monitor then attaches (and again
  after every restore). Inert without a document or without a mount: nothing is created and nothing
  is registered.
- **onStop** `({ config, state }) => stopRenderer({ config, state })` answers a waiting capture
  with `undefined` and forgets the frame counters, then runs the cleanups of `sync`,
  `viewport` and `host` in that order, destroys the pooled objects and the application
  (`{ removeView: true }`, `{ children: true, texture: false }`), swaps Pixi's own draw classes
  back, removes the two safe-area probes and the unsupported element and clears every map, the filter slots too. It runs before `world` stops, so the world hooks are
  removed while `world` is alive. Textures are left to `assets`; a `Display` object is detached,
  never destroyed. The pool trim starts over and its listeners go, and both `viewport.size()`
  objects are dropped; Pixi's texture pool itself is left alone, since it is module-global and
  another app on the page may be drawing.

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
| `debug` | `game.debug` | `{ nineSlice: "boolean?", verifyFrames: "boolean?", kept: "boolean?", overdraw: "boolean?" }` | cosmetic | `sync.debug.nineSlice(on)`, `sync.debug.verifyFrames(on)`, `sync.debug.kept(on)`, `sync.debug.overdraw(on)`, each field given; `{ kept: false }` alone is the editor's A/B switch, `{ overdraw: true }` Mission control's heat map. Answers `sync.debug.state()` |

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
a label under a 0.6 parent at 0.6, and the same pixels as the per-label shader drew, in the browser, under
WebGPU and under WebGL. So does the alpha of a parent: the icon of a disabled round button measured
at 0.6 in the browser.
