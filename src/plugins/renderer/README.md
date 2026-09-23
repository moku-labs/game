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
| `Transform({ x, y, rotation, scale, pivot })` | `0, 0, 0, 1, { x: 0, y: 0 }` | Reference units, radians, uniform scale. Relative to the `Parent` when there is one. `pivot` is the local point the view turns and scales around; `x`, `y` is where it lands. |
| `Sprite({ texture, tint, alpha, anchor, width, height, fit })` | `"", 0xffffff, 1, { x: 0.5, y: 0.5 }, 0, 0, "fill"` | `texture` is an asset key. `width`/`height` are the box in reference units; 0 keeps the texture's own size on that axis. `fit` is `"fill"`, `"contain"` or `"cover"`. |
| `NineSlice({ texture, width, height, alpha, tint })` | `"", 0, 0, 1, 0xffffff` | Size in reference units; the borders come with the texture. |
| `Parent({ entity })` | `0` | "Moves with its parent". It never decides draw order between layers. |
| `Display({ object })` | `undefined` | The game owns a Pixi object. Never pooled, never destroyed by `sync`. |
| `Shape({ w, h, fill, fillAlpha, alpha, radius, stroke, strokeWidth, clip })` | `0, 0, 0xffffff, 1, 1, 0, 0x000000, 0, false` | A filled rounded rectangle drawn with `Graphics`, anchored top left. `fillAlpha` is the alpha of the fill alone: `0` draws only the stroke, a ring. `alpha` fades the whole shape. `clip: true` masks the children of the entity to the rectangle; the mask is always filled. |

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
| `displays.provide(Component, adapter)` | A plugin above says how its own component becomes a display object: `create` on the first pass after it appeared, `update` on every change, `destroy` when it leaves. Stored while inert, never called there. Returns the remover. |
| `fonts.install(key, fnt, texture)` | Installs a BMFont file (text, XML or JSON) and its page texture under an asset key. Throws while the renderer does not draw. |
| `fonts.installed(key)` | Whether that font key is installed in this application. |
| `displayOf(entity)` | The Pixi object of the entity, for debugging. |

There is no `sync.layers`: layers are declared by the scene, through `world.projection.setLayers`.
An adapter object is parented, sorted and freed like a sprite; its hit box is `getLocalBounds()`
read at attach, as a `Display` object's is. A point outside the rectangle of a `clip: true` ancestor
hits nothing inside it. The hit test moves the point into the view's local space through the pose
helpers below, pivot included.

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
0 and the transform moves to the wrapper. A wrapper sorts its children: a parented entity takes
`zIndex` from its `Order` (0 without one) when it is attached and when `Order` changes, whatever
layer its parent is in. The parent's own visual has depth 0, so a child with the same depth draws
above it and a child with a negative `Order` below it. A layer container keeps its own sort rule.
Removing `Parent` puts the view back in the layer its `Layer` names, at its own pose, in the same
pass: `world` records no change for a removed component, so `sync` watches `onRemoved(Parent)`.

## Textures

`resolve(key)` asks the providers from the newest to the oldest; the first non-`undefined` wins.
Nothing answers: the view draws `Texture.WHITE` at 64×64 with tint `0xff00ff`, and `ctx.log.warn`
reports the key once. The key is not asked again per frame — only `invalidate(keys)` makes it
resolve again. `assets` owns texture lifetime: it calls `create`, answers through its provider, and
calls `invalidate` then `destroy` on unload. The renderer never destroys a texture by itself; the
crops it cuts for `"cover"` sprites share the base's source. A crop is freed when its last sprite
lets go, with its base (`destroy`), when its key answers a new texture, and when the renderer stops.

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
