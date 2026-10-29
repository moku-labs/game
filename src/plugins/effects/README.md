# effects

> Complex plugin — cosmetic rendering extras as data. `defineEmitter` describes a particle effect; the `Emitter` component on an entity runs it on one Pixi `ParticleContainer` stepped by the engine clock. `defineFilter` turns a WGSL fragment body and its GLSL twin into a flat component type, so the existing `tween` drives it, on WebGPU and on the WebGL fallback alike. Seven filters ship built in. Nothing here enters `model`, the journal or a save. Opt-in: a game composes `[...screen, effectsPlugin]`.

```ts
// kit.ts of a game: the ids and keys are checked by the compiler
export const { defineFeature, projection, Sprite, defineEmitter, Emitter, Displacement } =
  defineGame<{ player: Player; session: Session; assets: AssetKey; strings: StringTable;
    emitters: "fx.starsBurst" | "fx.steam" }>();

// features/board/effects.ts — data next to the feature
export const starsBurst = defineEmitter("fx.starsBurst", {
  textures: ["fx.star", "fx.sparkle"], burst: 40, lifeMs: [500, 900], speed: [300, 700],
  gravity: 900, drag: 0.2, shape: { kind: "circle", radius: 24 }, alpha: { from: 1, to: 0 }
});
export const steam = defineEmitter("fx.steam", {
  textures: ["fx.puff"], rate: 12, lifeMs: [900, 1400], space: "local", prewarmMs: 1000
});
export const Tint = defineFilter("fx.tint", {
  // WebGPU: the uniforms are fields of `fu`.
  wgsl: /* wgsl */ `
    @fragment
    fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
      let c = textureSample(uTexture, uSampler, uv);
      return vec4<f32>(mix(c.rgb, fu.color * c.a, fu.amount), c.a);
    }`,
  // WebGL: the same math in GLSL ES 3.0; the uniforms go by their bare names.
  glsl: /* glsl */ `
    void main() {
      vec4 c = texture(uTexture, vTextureCoord);
      finalColor = vec4(mix(c.rgb, color * c.a, amount), c.a);
    }`,
  uniforms: { amount: 0, color: { color: 0xffd700 } }
});
export const boardFeature = defineFeature("board", { emitters: [starsBurst, steam], filters: [Tint] });

// a view: components next to the sprite
generator: item => [Sprite({ texture: "board.generator" }), Emitter({ effect: "fx.steam" })];
card: item => [Sprite({ texture: "board.card" }), Glow({ strength: 0 }), Tint({ amount: 0 })];

// a motion hook: a burst on a merge, a glow tweened away
view.set(Emitter, { effect: "fx.starsBurst" });
view.tween(Glow, { strength: 0 }, { ms: 200 });
```

## Particles

Particles report their steps to the renderer (`renderer.invalidate` around a step), so with `renderer.onDemand` a
frame is drawn while they live and once when the last one dies: nothing for a game to do.

`defineEmitter(id, config)` validates and freezes `{ id, config }`, every default filled in. Every field is optional except `textures` and exactly one of `burst` and `rate`. A mistake throws at definition, in the `[game]` two-line format.

| Field | Default | Rule |
|---|---|---|
| `textures` | — | 1 to 16 asset keys of one atlas page; a particle picks one at random |
| `burst` | — | Integer ≥ 1. Emits once when the component appears or `effect` changes |
| `rate` | — | Particles per second, > 0, while `active` is true. A fractional carry makes 60 Hz and 120 Hz emit the same count |
| `lifeMs` | `[600, 1000]` | min > 0 |
| `speed` | `[0, 0]` | Reference units per second, min ≥ 0 |
| `angle` | `[0, 360]` | Degrees, 0 is right, 90 is down |
| `gravity` | `0` | Reference units per second², downward |
| `drag` | `0` | 0..1: `v *= (1 − drag) ^ seconds` |
| `spin` | `[0, 0]` | Radians per second |
| `shape` | `{ kind: "point" }` | `point`, `circle { radius }`, `rect { w, h }`, `ring { radius, width }`, uniform over its area |
| `scale`, `alpha`, `tint` | `1 → 1`, `1 → 1`, white → white | `{ from, to }` over life, linear; `tint` per channel |
| `space` | `"world"` | World: particles outlive the entity. Local: they move and die with it |
| `prewarmMs` | `0` | 0..5000, simulated in 16 ms slices before the first frame |
| `maxParticles` | `256` | Integer 1..5000, the ceiling of one instance |
| `blend` | `"normal"` | `"normal"` or `"add"`, the blend of the container |

`Emitter({ effect, active })` defaults to `"", true` and is plain JSON in `snapshot()`. `""` draws nothing; an unknown id warns `effects:unknown-emitter` once per id.

### One instance, one container

The first frame an `Emitter` names an effect, the effect is baked (64-entry scale, alpha and tint tables, the reach of its particles, its textures) and an instance starts: one `ParticleContainer` with the dynamic set `{ position, vertex, rotation, color }` (`uvs` static), its first texture, its blend, and a `boundsArea` of the reach, so a future culling pass never hides it. The container is the `Display` of an entity owned by `{ kind: "plugin", name: "effects" }`, with a `Transform` and the `Layer` and `Order` of the top of the host's `Parent` chain copied (the first ancestor without a `Parent`, or the host itself). The renderer draws a parented view in the layer of its top ancestor, so a burst on a slot-hosted view draws above the screen that hosts it; in a layer sorted by `"y"` or `"order"` the particles tie with that ancestor and draw just above it. The entity has no gesture component, so `input` never accepts it, and no `Parent`, in either space.

- **World space**: the container stands at the host's root point and stays there. A stream emits from where the host is now, so a moving stream leaves a trail.
- **Local space**: the system compares the container's `Transform` with the host's root pose every frame and writes it when the pose moved, so the particles move with the host; a still host writes nothing, and the renderer has nothing to sync. The pose is computed into one reused object (`rootPoseInto`).

The seed of an instance is `seedOf(id, ordinal)`, its random source xorshift32: never `Math.random`, never the model's rng, so a visual checkpoint renders the same twice.

### The step

One system, `effects:particles`, phase `animate`: `world` skips it while paused and in a fast walk, so particles freeze with the clock and a fast walk emits nothing. Per instance and frame: the stream emits what its carry owes (never past `maxParticles`), every particle ages, falls, slows, moves and spins, takes the scale and the packed colour of its age, and dies at its life by swap-remove; one `update()` follows when anything was born or died. Never `addParticle` or `removeParticle` per particle.

Under reduced motion (`anim.reducedMotion()`, read every frame) a `rate` stream stands still, like a `Frames` loop (WCAG 2.3.3): it emits nothing, and its live particles keep their place, age and look; no upload runs. A local-space container still follows its host. When reduced motion turns off the stream resumes where it stood. A burst is never held: it is skipped where it is played (a timeline under reduced motion), and one already flying runs out. An orphan runs out too. A stream started under reduced motion shows its prewarm, standing. This is why `effects` depends on `anim`.

An instance whose effect changes, or whose host loses its `Emitter` or despawns, retires: a local-space or empty instance is destroyed at once (entity despawned, container destroyed without its textures), a world-space instance with live particles becomes an orphan that flies until its last particle died.

A texture that is not loaded warns `effects:missing-texture` once per key and the effect is tried again next frame. Pixi binds one page per container and samples the wrong one silently, so in a dev build textures of two sources (loose files) warn `effects:atlas` once per effect id, `{ effect, keys, dropped }`, and the effect draws with the textures that share the first texture's source. A packed build puts every fx texture on one page and never warns.

## Filters

`defineFilter(id, { wgsl, glsl, uniforms?, passes?, padding?, inputs?, fallback?, cache?, area?, resolution?, backdrop? })` returns a component type named by its id with its `filter` attached. Both bodies are required: Pixi picks the one of the backend that draws, and iOS simulators, iPhones below iOS 26 and many Android phones draw with WebGL.

- `wgsl` is the WGSL fragment body only: `fn mainFragment` and its helpers. The engine prepends the vertex stage, the input bindings `gfu`, `uTexture`, `uSampler`, and a `FilterUniforms` struct in declaration order bound as `fu`. The body reads `fu.amount`.
- `glsl` is the same math in GLSL ES 3.0: `void main()`, which sets `finalColor`, and its helpers. The engine prepends `#version 300 es`, `precision highp float;`, `in vec2 vTextureCoord;`, `out vec4 finalColor;`, `uniform sampler2D uTexture;`, Pixi's global filter uniforms `uInputSize`, `uInputPixel`, `uInputClamp`, `uOutputFrame`, `uGlobalFrame`, `uOutputTexture` as `vec4`, and one `uniform` per declared uniform under its bare name. The body reads `amount`. The vertex stage is Pixi's `defaultFilterVert`.

`filter.source` holds the assembled WGSL and `filter.glsl` the assembled GLSL.

| Uniform declaration | WGSL | GLSL | Component field |
|---|---|---|---|
| `amount: 0.5` | `f32` | `uniform float amount;` | a number, tweenable |
| `color: { color: 0xffd700 }` | `vec3<f32>` | `uniform vec3 color;` | the hex number |
| `offset: [2, 3]` (2 to 4 numbers) | `vec2<f32>` … `vec4<f32>` | `uniform vec2 offset;` … `vec4` | an array, not tweenable |

Every filter component also carries `enabled: true` (a disabled filter costs nothing and reassigns nothing) and `order: 0` (the filters of a view sort by `order`, then by registration). `passes` (default 1) is what one apply costs; `padding` is pixels, or the name of a number uniform whose live value it is; `resolution` (default 0, the resolution of the canvas) is the texels per CSS px, from 0 to 4, the view and its filters are drawn at under this filter; a filter with inputs runs its chains first at it. A WGSL without `mainFragment`, a GLSL without `void main(`, a reserved or badly named uniform, a bad `passes`, `padding` or `resolution` (below 0, above 4 or not a number) throw at definition; a duplicate id or the id of a built-in throws in `onStart`. The reserved names are `enabled`, `order` and the names the headers declare: `uInputSize`, `uInputPixel`, `uInputClamp`, `uOutputFrame`, `uGlobalFrame`, `uOutputTexture`, `uTexture`, `uSampler`, the GLSL header's `finalColor` and `vTextureCoord`, and a backdrop's `uBackTexture`, `backScale`, `backClamp` and `sampleBack`.

### Area: the box a filter draws in

`area` (spec 27 B4) answers, from the component's value, the rectangle `[x, y, width, height]` outside of which the filter draws nothing, in the filtered entity's own units: the space its box, its hit box and its children's positions are in (reference units for a view at the root without scale). Pixi then renders the view and fills the filter only inside that box, which moves, scales and turns with the view, instead of the view's bounds. Outside it Pixi draws nothing of the view at all, neither the filter nor the view's own content: declare it only for a filter whose output is transparent there. `undefined` means the view's bounds.

```ts
export const LensWindow = defineFilter("LensWindow", {
  wgsl: LENS_WGSL,
  glsl: LENS_GLSL,
  uniforms: { view: [0, 0, 1], cx: 195, cy: 189, rev: 84, inner: 4, soft: 4 },
  // Outside the disc the lens draws nothing: Pixi renders and fills only this box.
  area: value => {
    const reach = value.rev + value.soft;

    return [value.cx - reach, value.cy - reach, 2 * reach, 2 * reach];
  }
});
// rev 84, soft 4: a 176 × 176 box at (107, 101) on the cover at the root, not the whole screen the cover covers.
LensWindow().value; // { view: [0, 0, 1], cx: 195, cy: 189, rev: 84, inner: 4, soft: 4, enabled: true, order: 0 }
```

The value has no new field: `area` lives on the definition (`LensWindow.filter.area`). A view with several enabled filters gets the union of their areas; a view with an enabled filter that declares no area (every built-in kind but `Alpha`, or an `area` that answered `undefined`) gets none. An `Alpha` does not count: it only scales the pixels the others draw, so `LensWindow` with its `area` beside an `Alpha` keeps the lens's box, and an `Alpha` alone gives the view no area. A disabled filter and a kind a debug switch turned off do not count. The area is asked only when the value changed, and the union is handed to `renderer.sync.filters.area` only when it changed. An `area` that throws logs `effects:area-failed` `{ kind, error }`, one that answers anything but four finite numbers with a width and a height of at least 0 logs `effects:bad-area` `{ kind, area }`, each once per kind, and counts as none. An `area` that is not a function throws at definition.

### Inputs: a second texture drawn by a chain of stages

`inputs: { blur: { stages, chain } }` gives the body a second texture to read, by name. For each input (at most 4) the engine declares, in the WGSL and in the GLSL it assembles, the texture `blurTexture`, its sampler `blurSampler` (WGSL only: on WebGL a texture carries its sampler state, `@group(1)` bindings `1 + 2k` and `2 + 2k`), two uniforms of its own, `blurScale: vec2<f32>` and `blurClamp: vec4<f32>`, and the function `sampleBlur(uv)`: the body calls `sampleBlur(uv)` and the scale and the clamp happen inside. The engine's two uniforms are no fields of the component and not in `filter.uniforms`; they are in `filter.inputs[k].scale` and `.clamp`.

- `stages` is the static list of the filters the chain may draw, each made by `defineFilter` and drawing alone (no inputs, no fallback of its own); a built-in kind cannot be a stage. They are checked on the device with the kind, before its first instance.
- `chain(value, { resolution })` returns the steps `{ stage, scale, uniforms? }`, in draw order, at most 16. Each place draws from the one before, the first from the view's own input (a backdrop's `from: "back"`: from what was drawn under the view, see "Backdrop"), into a pooled texture of the input's frame at `resolution × scale` (the scale is a share of the input's resolution, above 0 and at most 1); the body reads the last one. A uniform a step leaves out takes the stage's default. An empty chain binds the view's own input and draws no stage.
- The chain runs at creation, when a uniform of the value changed (an in-place `world.set` included) and when the resolution of the view's input changed, never per frame and never for `enabled` or `order`; a filter that is off, or a kind switched off by the diagnostics, runs it when it is drawn again.
- Each place is its own Pixi `Filter` with its own uniform group, drawn through Pixi's public `applyFilter` from inside the main filter's `apply`. Every pooled texture goes back to the pool in a `finally`, also when a place throws, and the inputs are bound to Pixi's empty texture again after every apply: a filter never holds a pooled texture between frames. A place that leaves the chain is destroyed by the next sync, never inside a render.
- The engine counts the passes: `1` (the body) plus the steps; leave `passes` out (with `inputs`, `passes` throws). `stats().filters` counts instances: the stages are counted in `renderPasses`, not in `filters`.
- A step whose stage is not in `stages`, a bad scale, a stage uniform the stage does not declare or of another form, more than 16 steps, a result that is not an array and a chain that throws break the instance (reason `"chain"`) in every build: the step is never drawn.

The slot the renderer gets carries `inputs`, `FilterSlotInputs`: the stage filters (so the monitor counts their applies under the kind), `count`, `version()` (it moves when a place, a scale, a stage uniform or the resolution changed), `scaleOf(index)`, and `draw` and `hold`, the seam of the kept-picture cache.

```ts
const Frost = defineFilter("Frost", {
  wgsl: FROST_WGSL, // let blurred = sampleBlur(uv);
  glsl: FROST_GLSL, // vec4 blurred = sampleBlur(vTextureCoord);
  uniforms: { view: [0, 0, 1], strength: 16, vivid: 1.2 },
  inputs: { blur: { stages: [FrostBox4, FrostHalf, FrostGauss], chain: frostChain } },
  fallback: FrostVeil
});
Frost.filter.inputs.map(input => input.sample); // ["sampleBlur"]
```

`fallback` is another filter made by `defineFilter`, drawing alone, over a subset of the filter's uniforms with the same types: it draws with the kind's value when the filter is broken.

### Backdrop: a filter that reads what was drawn under its view

`backdrop: true` (change 2026-10-18-memory-render, B1) makes a filter read the canvas under its view, inside its box: the view's bounds, or its `area`. Pixi copies that part of the surface the view is drawn into (the canvas, or an enclosing filter's texture) before the view draws, the filter's `blendRequired`, and binds the copy at group 0 binding 3. The engine declares, in both languages, `uBackTexture`, two uniforms of its own, `backScale: vec2<f32>` and `backClamp: vec4<f32>`, filled by every apply from the copy, and `sampleBack(uv)`: what was drawn under the pixel the body draws. An input may start from it, `from: "back"`: its first step reads the copy instead of the view's own input, and its chain runs at the resolution of the surface under the view (`context.resolution`), again only when that changes. The body's output is laid over the canvas like the view's own pixels: where it answers transparent the canvas stays as it is.

So one frost on the layer of a screen's panels replaces a frost on the root of the scene: the scene is drawn straight to the canvas, and only the box of the panels is copied and blurred.

```ts
export const Frost = defineFilter("Frost", {
  wgsl: FROST_WGSL, // let blurred = sampleBlur(uv); the panel's own pixels: textureSampleLevel(uTexture, uSampler, uv, 0.0)
  glsl: FROST_GLSL,
  uniforms: { view: [0, 0, 1], rectA: [0, 0, 0, 0], strength: 16, vivid: 1.2 },
  backdrop: true,
  inputs: { blur: { from: "back", stages: [FrostBox4, FrostHalf, FrostGauss], chain: frostChain } },
  // Only the panel is copied and blurred, not the layer's whole bounds.
  area: value => [value.rectA[0] ?? 0, value.rectA[1] ?? 0, value.rectA[2] ?? 0, value.rectA[3] ?? 0],
  fallback: FrostVeil
});
[Frost.filter.backdrop, Frost.filter.cache, Frost.filter.inputs[0]?.from]; // [true, "screen", "back"]
```

- A backdrop is drawn live in every frame, never kept as a picture (its category is `"screen"`; `cache` may only be left out or `false`); a change of what is drawn under it is a change of that view and draws the frame, also on demand. The kept cache also refuses any filter with `blendRequired`. Inside the range an `Overlay` keeps as one picture it runs no pass while the picture stands: it is drawn into the picture when it is taken, and live again in the frame the overlay is gone (renderer README, "Overlays and the HUD").
- It has no padding: Pixi copies the padded box, and a copy past the canvas edge fails on the GPU. A padded filter beside it on the same view (`Glow`, `Outline`) pads the copy too: keep the backdrop's view to itself.
- A stage is no backdrop (it reads the step before it). A fallback may be one only for a backdrop; a fallback that is none draws over the view's own pixels alone.
- Its slot says it blurs (`blurs`) only for an input from the view's own input: a chain from back blurs the scene under the view, not the view, so an overlay over it holds no loops for it.
- WebGL copies from Pixi's back buffer: the renderer asks for it when a feature brings a backdrop (renderer README, `preference`); WebGPU copies from the canvas.
- Inside the box, everything already drawn under the view is in the copy: the scene and an overlay's dim alike.

### Filters that are kept

The renderer keeps a still view under a filter as a picture (renderer README, "Kept pictures"): the
filter runs once, and its output is drawn as one quad while nothing it depends on changes. What it may
do with a filter is its category, `FilterDefinition.cache`:

- `"local"` — the default: the output depends on the view's own pixels and the uniforms only; kept,
  also while the view moves.
- `"placed"` — the body reads its canvas position through `canvasPixel(uv)`, or declares
  `cache: "placed"`; kept, and a move redoes the output only, with the new origin.
- `"screen"` — never kept: the view is drawn live in every frame. `cache: false`, a backdrop, Pixi's `Noise` and
  `Displacement`.

The category is the option `defineFilter(id, { cache?: "local" | "placed" | false })`. The engine reads
only the bodies the game wrote, never its own header: a body that reads `uGlobalFrame`,
`@builtin(position)`, `gl_FragCoord`, `uOutputTexture` or the origin of `uOutputFrame` (its size `.zw`
is fine) and declares no `cache` is drawn live (the safe direction), and a dev build warns once
(`effects:filter-reads-screen`: "Filter "X" reads the screen; declare cache: false"). A declared
category is honoured. A filter with inputs takes the worst category of its body and its stages.

`canvasPixel(uv)` answers the pixel's canvas position in CSS px, in WGSL and GLSL, generated by the
engine for a body that calls it (with the engine uniform `keptOrigin`; `keptOrigin` and `canvasPixel`
are reserved names). Drawn live its origin is 0; in a picture the renderer writes the picture's canvas
origin, so the answer is the same. The game's idiom moves to it in one line:

```wgsl
// before: drawn live in every frame
let canvas = gfu.uOutputFrame.xy + uv * gfu.uInputSize.xy;
// after: kept as a picture at rest
let canvas = canvasPixel(uv);
```

A body that does not call it assembles byte-identically. Each slot handed to the renderer carries its
category (`cache`), a placed filter's `keptOrigin` array by reference (`origin`), and `blurs: true`
for a `Blur` and a filter with an input from the view's own input (an overlay over it holds the loops under it,
spec 22).

### Built-in filters

| Component | Fields and defaults | Source | Passes |
|---|---|---|---|
| `Glow` | `strength: 2, distance: 10, color: 0xffffff, alpha: 1` | our WGSL and GLSL, padded by `distance`; 64 to 256 probes per pixel, by radius in physical pixels | 1 |
| `Outline` | `thickness: 2, color: 0x000000, alpha: 1` | our WGSL and GLSL, padded by `thickness` | 1 |
| `Blur` | `strength: 8, quality: 0, resolution: 0, repeatEdgePixels: true` | Pixi `BlurFilter` | `2 × quality` |
| `ColorMatrix` | `brightness: 1, saturation: 0, contrast: 0, hue: 0, grayscale: 0` | Pixi `ColorMatrixFilter` | 1 |
| `Noise` | `amount: 0.5, seed: 0` | Pixi `NoiseFilter`, the seed always given | 1 |
| `Displacement` | `map: "", scaleX: 20, scaleY: 20` | Pixi `DisplacementFilter` over a sprite of the asset `map` | 1 |
| `Alpha` | `alpha: 1, resolution: 0` | Pixi `AlphaFilter` | 1; none at `alpha: 1, resolution: 0` |

`Glow` is a soft halo that follows the shape: its alpha is `strength × alpha ×` the weighted share of the disc of radius `distance` around the pixel that the view covers, each probe weighted by `(1 − r / distance)²`. That share is about ½ next to a straight edge; it falls fast near the edge and then slowly to 0 at `distance`, with no step at the rim, so the halo reads as a glow, not as a flat band. `strength: 2` is full at the edge, rounded corners stay rounded, and the padding beyond `distance` stays clear. Most of the light sits in the inner half of `distance`: a wider glow takes a larger `distance`. The probe count grows with the radius in physical pixels, `clamp(ceil((distance × resolution)² × 0.25), 64, 256)`: 64 for `distance` up to 16 at DPR 1, 225 for `distance: 10` at DPR 3. That keeps the probes about 3.5 physical pixels apart up to a radius of 32 physical pixels, so a glow on a dense screen does not band; past it the count stays 256 and the probes spread wider. The probes sit on a golden-angle spiral, so no rings or spokes show; every probe is clamped to the input frame. The halo is premultiplied and drawn under the source pixel. The GLSL of `Glow` and `Outline` does the same math as their WGSL, line for line; Pixi's core filters ship both languages themselves.

Every filter but `Blur` renders at `resolution: "inherit"`: the resolution of the canvas, so a filtered view stays sharp on DPR 2–3. `Blur` keeps its own: with `quality: 0` it uses `config.blur.quality`; with `resolution: 0` it uses `config.blur.phoneResolution` on a phone, otherwise 1. An `Alpha` with a `resolution` above 0, and a filter whose definition gives one, draw at that many texels per CSS px, at most 4 (an `Alpha` above it draws at 4); 0 is the canvas's. Pixi draws all the filters of one view at the smallest resolution among them: `Alpha({ resolution: 0.5 })` on a view with `Glow` draws the glow at 0.5 too, and `Blur` at its 1 lowers the others on its view on DPR 2–3.

An `Alpha` at `alpha: 1` and `resolution: 0` would copy its subtree unchanged through a pass of its own, so its filter is switched off (`enabled: false` on the Pixi filter; the component keeps `enabled: true`): at once when it is built so, otherwise once its value stood so for 8 syncs in a row (the kept cache's `CALM_AFTER`), the view synced again in every frame meanwhile, also on a still screen. Keyframes that touch 1 for fewer frames keep the pass and switch nothing: a switch hands Pixi a new filter list, rebuilds the view's render group and lets a kept picture of it go live. Once off, the view draws as if the `Alpha` were not there and costs no pass, and `renderPasses` counts none. With no other filter it is not kept as a picture either: there is no pass to save. Below 1 and kept, an `Alpha` alone (or several) at `resolution: 0` costs no pass while it fades: the kept picture's quad draws at its alpha (renderer README, "Kept pictures"). A child that blends other than normally (an additive emitter) then blends with what is under the view, not inside the Alpha's layer. Leaving 1, or setting a resolution, switches it back on at once; either switch is a change the renderer draws, also on demand and from a kept picture. The warm-up probe of `Alpha` stays switched on.

### The filter sync

One system, `effects:filters`, phase `sync`, in every world mode. It walks the views the world hooks recorded, never the whole world, and brings up to date only the views something happened to: a filter component of the view changed (the change set of every kind, ours and the core kinds), came or left, its `Displacement` map was retired, a kind still waits for its instance (its check pending, its map not loaded), or a chain left places to destroy. A debug switch, and a filter that broke or ran its chains at a new resolution inside a render, bring every view up to date at the next sync. A frame where none of that happened syncs no view and allocates nothing:

- One instance per view and kind, made the first frame the kind is seen and kept until the component or the entity leaves. An instance of ours carries both programs, a `GpuProgram` of the WGSL and a `GlProgram` of the GLSL over `defaultFilterVert`, and one uniform group: Pixi binds it as `fu` on WebGPU and by bare uniform name on WebGL. `GpuProgram.from` and `GlProgram.from` cache by source, so every view of a kind shares its programs.
- Every write compares first. Ours compare each uniform with what the group holds (a number as it is, a colour or a tuple element by element as the `Float32Array` stores it, rounded to float32; two NaN are equal) and the padding named after a uniform; only what differs is written, no `update()`. The core kinds compare the fields their setters were last given, only on a frame their component changed, and call the setters only when one differs (`ColorMatrix` starts from `reset()`); an equal value written by a system calls no setter. `enabled` is written only when it flips.
- A write the player can see, a filter switched on or off or a new value of a filter that is on, calls `renderer.invalidate(entity)` first, once per view and frame, so the renderer judges the view as it was last drawn. A filter that is off and stays off takes its new values silently; so does a kind a debug switch turned off. A new instance, a new order or new passes reach the renderer through `filters.set`, never through `invalidate`.
- `renderer.sync.filters.set(entity, slots)` with a new frozen list of `{ filter, passes, kind, inputs? }` only when the kinds, their order, their passes or the stage filters of their inputs changed. A filter covers the entity's subtree: a glow on a button glows its label.
- A removed kind, or a despawn, destroys every uniform buffer of the instance, then the instance; `Filter.destroy()` alone leaves the buffer to a GC that runs after a minute. A despawned entity gets no call: the renderer let its view go.
- The shader check runs in every build. Every definition a registered kind can draw, its body, every stage of its inputs and its fallback, is compiled once on the backend that draws, `renderer.host.kind()`, when the renderer first draws (the first frame with a ready host, or the first node entry, whichever comes first), once per definition object. On WebGPU the WGSL goes through `renderer.host.device()`: every error logs `effects:wgsl` with its line and column. On WebGL the GLSL goes through `renderer.host.gl()`: in the background with `KHR_parallel_shader_compile`, answered on a later frame, otherwise at once; every error line of the info log logs `effects:glsl` `{ filter, line, message }`, and the shader is deleted. Lines count in the assembled source. When every definition answered, `effects:checks` `{ definitions, broken, ms }` is logged once. The check costs one extra shader module (WebGPU) or one extra fragment compile (WebGL) per definition, once per run, at the first drawn frame.
- The warm-up (spec 27 F4): the first frame with a ready host notes the Pixi-core kinds and, once every check of the run answered, hands the renderer a probe of each, then of every definition the checks passed (the body of every ready kind, every stage of its inputs, every checked fallback; never a definition that failed), through `renderer.sync.filters.warm`. The renderer draws them invisibly before its frames, so the first screen that draws a kind creates no pipeline. A core probe is an instance at the defaults of its component (a `Displacement` over Pixi's white texture: the program does not depend on the map), guarded like any instance; a probe of ours has no chain wired. The probes live until the app stops (the renderer warms them again after a restore). When the renderer answers `false` at once (nothing to warm: `renderer.warm: 0`), the probe is destroyed and no further probe is built.
- A kind gets no instance until its body and every stage answered ok: a view of a pending kind draws unfiltered, never with an unchecked shader, and logs `effects:check-pending` `{ filter }` once per kind. The `load` stage of every node entry waits for any check still pending (`effects:mount-waited` `{ node, ms }`), so the boot's first scene mounts with its filtered views already filtered, together with the boot bundles, and no mounted scene draws a pending kind's view. A renderer that draws nothing (headless, the unsupported screen) waits for nothing; an aborted node stops waiting.

### Broken: one state, `fallback`, the dev mark, never a blank frame

A shader that does not compile on the device (the body or one of its stages, reason `"compile"`, the whole kind), an `apply` that throws (reason `"apply"`, one instance) and a chain that throws or returns a step it may not draw (reason `"chain"`, one instance) lead to one state, broken, with one behaviour:

- the log holds one `effects:broken` error per kind and reason per run, in every build: `{ filter, reason, message, stage?, input?, fallback? }` (`stage`: the stage that failed to compile; `input`: the input whose chain failed; `fallback`: the declared fallback's id). A fallback that fails its own check logs `effects:broken` under its own id, once;
- the declared `fallback` draws instead, with the kind's value, once its own check answered ok (a broken kind waits a frame or two for that answer, unfiltered); without one, or with a broken one, the view draws unfiltered;
- in a dev build a striped magenta mark is drawn over the view, over its fallback when there is one: diagonal stripes 6 CSS px wide over the whole filter area, visible on transparent pixels too, so a broken view cannot be mistaken for a design choice. A production or debug build never draws it, and a release bundle holds neither the mark nor its shader;
- nothing is retried: a broken kind never gets an instance of its own definition again in this run, a broken instance stays until the filter sync retires it.

Every Pixi filter the engine builds, ours and the core kinds, a `Blur` on both its passes too, has one guard around its `apply`. A shader that binds a texture the engine never filled, or a destroyed `Displacement` map, throws inside Pixi's `apply`; Pixi's `FilterSystem.pop` has no `try/finally`, so the throw would skip the return of the view's pooled textures every frame. Instead the instance breaks for good: in that same frame the guard draws its stand-in (the fallback, with the mark in a dev build) or, without one, the view straight through, unfiltered; the next sync puts the stand-in in the slot list without building it again, and a stand-in that breaks in its turn draws through, with no stand-in of its own. No pooled texture is lost, with one exception: inside a `Blur` of quality 2 or more, the pass that threw keeps the one temp texture of its own multi-pass loop, once, in the frame it breaks (Pixi takes it inside that pass, out of the guard's reach). Nothing is retried. The instance stays until the filter sync retires it (the kind leaves the view, the entity despawns, its map is retired, a hot swap rebuilds it); a new instance starts unbroken. The fix is in the shader or its bindings.

## Config

| Key | Default | Meaning |
|---|---|---|
| `maxParticles` | `3000` | Live particles over all instances above which `effects:particle-budget` warns once per crossing |
| `maxPasses` | `24` | Render passes per frame, `renderer.sync.renderPasses()`, above which `effects:pass-budget` warns once per steady crossing: 60 frames in a row over it, so the first takes of a scene that appears do not warn. Read once per frame and only while a filtered view exists: with none, the frame is at most one pass under any budget |
| `phone` | `"auto"` | Whether this device is a phone. `"auto"`: a coarse pointer and a short side of at most 820 CSS px, read once in `onStart` |
| `blur` | `{ quality: 2, phoneResolution: 0.5 }` | What a `Blur` with `quality: 0` and `resolution: 0` resolves to. Shallow merge: a game that sets `blur` gives both fields |

More than one full-screen view with an enabled filter warns `effects:full-screen-filters` once per crossing. A view is full-screen when the box its `Sprite`, `NineSlice` or `Shape` declares, times its `Transform.scale`, covers the viewport; when its enabled filters declare an `area`, that area (their union) takes the place of the box, so a lens over a full-screen sprite counts only when its area covers the viewport. The count is taken again only on a frame a filtered view was synced or forgotten, the viewport changed size, or the `Transform`, `Sprite`, `NineSlice` or `Shape` of a filtered view changed; otherwise the last count stands.

## API — `app.effects`

| Member | Behaviour |
|---|---|
| `stats()` | `{ particles, emitters, filters, renderPasses }`, a fresh object: live particles, instances plus orphans, filter instances over every view, and `renderer.sync.renderPasses()` read at call time. Headless every number is 0 |
| `diagnostics.kinds()` | the filter kind ids in registration order: the seven built-ins, then the `filters` of every feature. The same frozen array on every call; empty before start. Every build |
| `diagnostics.disable(kind)` | turns a kind off: from the next frame no view draws it (no apply, no render pass). `true` when the kind is known and now off |
| `diagnostics.enable(kind)` | turns it on again: from the next frame its views draw it with their current values. `true` when the kind is known and now on |
| `diagnostics.disabled()` | the off kinds in registration order; the same frozen array until the next change |

### Diagnostics — the switches of a debug build

`disable` and `enable` act on a dev or agent page only (`__MOKU_GAME_DEV__` or `__MOKU_GAME_AGENT__`, written inline and positive, so a release build drops their bodies and their log events); elsewhere they answer `false`, change nothing, and `disabled()` stays `[]`. An unknown kind answers `false` and warns `effects:diagnostics-unknown` once per id; a kind already in the asked state answers `true` and logs nothing. A switch logs `effects:diagnostics` `{ kind, on }` and writes the event `switch` `{ kind, on }` into the renderer's performance log (`renderer.monitor.event`).

The filter sync still brings an off kind up to date on every view (its instance is made, its values written, its change marks consumed) and only leaves it out of the slot list it hands `renderer.sync.filters.set`: the list is set once at the frame of the switch, and once more after `enable`. No instance is made or destroyed by a switch, so no shader compiles and nothing leaks. While a kind is off, `stats().filters` still counts its instances and `renderPasses` drops by its passes; the full-screen budget does not count a view whose only drawn filters are off. A switch does not survive `stop`/`start` nor a page reload.

```ts
// On the phone's debug build, from the MCP or chrome://inspect: four cards with Glow and a two-pass Tint.
app.effects.stats().renderPasses; // 13
app.effects.diagnostics.disable("effects.glow"); // true
app.time.step(16);
app.effects.stats().renderPasses; // 9; stats().filters stays 8
```

## Typed ids

`GameTypes.emitters` types `Emitter.effect` and the id of `defineEmitter`; `Emitter.effect` also takes `""`, its default, which draws nothing, and `defineEmitter` never does (F81); the game's asset keys type `textures` and `Displacement.map`. `defineGame` spreads `effectsFor<Assets, EmitterIdOf<Types>>()`; the root exports accept any string.

## Headless

`renderer.host.ready()` is false: both systems return at once, no particle entity is spawned, no Pixi class is touched, no shader is checked, the `load` gate waits for nothing, `stats()` answers zeros. `onStart` still reads every definition, so a headless test catches a duplicate id. `Emitter` and every filter component are stored like any component: `snapshot()` shows `{ Emitter: { effect: "fx.steam", active: true }, "effects.glow": { strength: 2, … } }`.

## Hooks

`assets:bundle-unloaded` retires every particle instance and every `Displacement` drawn with one of its keys, whatever their space, drops their bakes, and lets the keys warn again. An effect is baked again once its bundle is back.

`assets:replaced` (dev only) does the same for the keys a hot swap gave new bytes: the next frame starts each emitter and builds each `Displacement` again from the new texture, so live particles of a replaced key are gone and a burst plays again.

`ui:hot-swap` (global, so no `depends` on `ui`) takes the exports of a module the dev server swapped. Each `defineEmitter` export whose id a feature registered replaces it, and its bake is dropped. A live instance keeps its own bake; the next instance bakes the new config. An id no feature registered warns `effects:hot-unknown-emitter`. Other exports are ignored.

### Hot swap (dev)

Save `features/board/effects.ts` while the dev server runs: a changed `starsBurst` plays its new config on the next burst, with no reload. A flying particle finishes with the old one. A new emitter id only warns: list it in a feature and reload the page.

## Lifecycle

`onStart` resolves the dependencies and the phone flag, registers the built-in kinds and then the `filters` of every feature, registers the `load` gate with `flow.onEnter`, reads the `emitters`, and opens the two systems with the world hooks. Nothing is compiled there: the host is not ready yet. `onStop` runs from state alone: it destroys every container, orphan, filter (with the places of its chains, its mark and a stand-in never put in place), probe of the warm-up and uniform buffer, clears the filters and the filter area of every view and deletes the GLSL compiles still in flight while `world` and `renderer` still run, removes the gate, and starts the checks over: an answer of the stopped run is ignored.

## Doors

`inspect.ts` holds `game.effects` (key `effects` in `sources`) of the editor's read door, safe in a production build: it reads `stats()` every frame.
Without `effectsPlugin` in the app it throws `[game] The source game.effects needs effectsPlugin.`
It also holds `game.filters` (key `filters`): `{ kinds, off }` of `diagnostics`, read every frame; `off` is always `[]` in a production build. Without `effectsPlugin`: `[game] The source game.filters needs effectsPlugin.`

`control.ts` holds `game.filter` (key `filter` in `commands`), a cosmetic command, so it runs on every debug page, `--debug=read` too: `{ kind, on }` switches the kind through `diagnostics` and answers `disabled()`. An unknown kind throws `[game] No filter kind "fx.nope".` with `Known:` and every id of `kinds()`; without `effectsPlugin` it throws `[game] The command game.filter needs effectsPlugin.` It carries no `overlay` marker: a game that wants a switch in the editor's overlay wraps the call in its own overlay command (`docs/doors.md`, "Overlay commands").

## Events

None. Nothing above `effects` needs to know a particle died or a filter was assigned; tests read `stats()`.

## Dependencies

`flow` (`features.all()`, `onEnter("load", …)` for the gate of the shader checks), `world` (systems, hooks, spawn and despawn, `Layer`, `Order`), `renderer` (`host.ready()`, `host.pixi()`, `host.kind()`, `host.device()`, `host.gl()`, `host.resolution()`, `sync.filters.set`, `sync.filters.area`, `sync.filters.warm`, `sync.renderPasses()`, `viewport.size()`, `Display`, `Transform`, `rootPoseOf`, `rootPoseInto`), `assets` (`texture(key)`, the `assets:bundle-unloaded` and `assets:replaced` hooks), `anim` (`reducedMotion()`). No package dependency: every Pixi class comes from `renderer.host.pixi()`.
