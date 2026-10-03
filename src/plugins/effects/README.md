# effects

> Complex plugin — cosmetic rendering extras as data. `defineEmitter` describes a particle effect; the `Emitter` component on an entity runs it on one Pixi `ParticleContainer` stepped by the engine clock. `defineFilter` turns a WGSL fragment body into a flat component type, so the existing `tween` drives it. Seven filters ship built in. Nothing here enters `model`, the journal or a save. Opt-in: a game composes `[...screen, effectsPlugin]`.

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
  wgsl: /* wgsl */ `
    @fragment
    fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
      let c = textureSample(uTexture, uSampler, uv);
      return vec4<f32>(mix(c.rgb, fu.color * c.a, fu.amount), c.a);
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
- **Local space**: the system writes the container's `Transform` from `rootPoseOf(host)` every frame, so the particles move with the host.

The seed of an instance is `seedOf(id, ordinal)`, its random source xorshift32: never `Math.random`, never the model's rng, so a visual checkpoint renders the same twice.

### The step

One system, `effects:particles`, phase `animate`: `world` skips it while paused and in a fast walk, so particles freeze with the clock and a fast walk emits nothing. Per instance and frame: the stream emits what its carry owes (never past `maxParticles`), every particle ages, falls, slows, moves and spins, takes the scale and the packed colour of its age, and dies at its life by swap-remove; one `update()` follows when anything was born or died. Never `addParticle` or `removeParticle` per particle.

An instance whose effect changes, or whose host loses its `Emitter` or despawns, retires: a local-space or empty instance is destroyed at once (entity despawned, container destroyed without its textures), a world-space instance with live particles becomes an orphan that flies until its last particle died.

A texture that is not loaded warns `effects:missing-texture` once per key and the effect is tried again next frame. Pixi binds one page per container and samples the wrong one silently, so in a dev build textures of two sources (loose files) warn `effects:atlas` once per effect id, `{ effect, keys, dropped }`, and the effect draws with the textures that share the first texture's source. A packed build puts every fx texture on one page and never warns.

## Filters

`defineFilter(id, { wgsl, uniforms?, passes?, padding? })` returns a component type named by its id with its `filter` attached. `wgsl` is the fragment body only; the engine prepends the vertex stage, the input bindings `gfu`, `uTexture`, `uSampler`, and a `FilterUniforms` struct in declaration order bound as `fu`.

| Uniform declaration | WGSL | Component field |
|---|---|---|
| `amount: 0.5` | `f32` | a number, tweenable |
| `color: { color: 0xffd700 }` | `vec3<f32>` | the hex number |
| `offset: [2, 3]` (2 to 4 numbers) | `vec2<f32>` … `vec4<f32>` | an array, not tweenable |

Every filter component also carries `enabled: true` (a disabled filter costs nothing and reassigns nothing) and `order: 0` (the filters of a view sort by `order`, then by registration). `passes` (default 1) is what one apply costs; `padding` is pixels, or the name of a number uniform whose live value it is. A missing `mainFragment`, a reserved or badly named uniform, a bad `passes` or `padding` throw at definition; a duplicate id or the id of a built-in throws in `onStart`.

### Built-in filters

| Component | Fields and defaults | Source | Passes |
|---|---|---|---|
| `Glow` | `strength: 2, distance: 10, color: 0xffffff, alpha: 1` | our WGSL, padded by `distance`; 64 probes per pixel | 1 |
| `Outline` | `thickness: 2, color: 0x000000, alpha: 1` | our WGSL, padded by `thickness` | 1 |
| `Blur` | `strength: 8, quality: 0, resolution: 0, repeatEdgePixels: true` | Pixi `BlurFilter` | `2 × quality` |
| `ColorMatrix` | `brightness: 1, saturation: 0, contrast: 0, hue: 0, grayscale: 0` | Pixi `ColorMatrixFilter` | 1 |
| `Noise` | `amount: 0.5, seed: 0` | Pixi `NoiseFilter`, the seed always given | 1 |
| `Displacement` | `map: "", scaleX: 20, scaleY: 20` | Pixi `DisplacementFilter` over a sprite of the asset `map` | 1 |
| `Alpha` | `alpha: 1` | Pixi `AlphaFilter` | 1 |

`Glow` is a soft halo that follows the shape: its alpha is `strength × alpha ×` the share of the disc of radius `distance` around the pixel that the view covers. That share is about ½ next to a straight edge and 0 at `distance`, so `strength: 2` is full at the edge, rounded corners stay rounded, and the padding beyond `distance` stays clear. The 64 probes sit on a golden-angle spiral, so no rings or spokes show; every probe is clamped to the input frame. The halo is premultiplied and drawn under the source pixel.

`Blur` with `quality: 0` uses `config.blur.quality`; with `resolution: 0` it uses `config.blur.phoneResolution` on a phone, otherwise 1.

### The filter sync

One system, `effects:filters`, phase `sync`, in every world mode. It walks the views the world hooks recorded, never the whole world:

- One instance per view and kind, made the first frame the kind is seen and kept until the component or the entity leaves. `GpuProgram.from` caches by source, so every view of a kind shares one program. WebGPU only: no `glProgram`.
- Our kinds write every uniform every frame, no `update()`; the core kinds go through their setters when the component changed (`ColorMatrix` starts from `reset()`). `enabled` is written every frame.
- `renderer.sync.filters.set(entity, slots)` with a new frozen list of `{ filter, passes }` only when the kinds, their order or their passes changed. A filter covers the entity's subtree: a glow on a button glows its label.
- A removed kind, or a despawn, destroys every uniform buffer of the instance, then the instance; `Filter.destroy()` alone leaves the buffer to a GC that runs after a minute. A despawned entity gets no call: the renderer let its view go.
- In a dev build a kind with its own WGSL is compiled once through `renderer.host.device()` before its first instance. Every error logs `effects:wgsl` with its line and column, and the kind never gets an instance, so the view renders as if it had none: one bad shader would otherwise blank the whole frame. A production build never asks the device.

## Config

| Key | Default | Meaning |
|---|---|---|
| `maxParticles` | `3000` | Live particles over all instances above which `effects:particle-budget` warns once per crossing |
| `maxPasses` | `24` | Render passes per frame above which `effects:pass-budget` warns once per crossing |
| `phone` | `"auto"` | Whether this device is a phone. `"auto"`: a coarse pointer and a short side of at most 820 CSS px, read once in `onStart` |
| `blur` | `{ quality: 2, phoneResolution: 0.5 }` | What a `Blur` with `quality: 0` and `resolution: 0` resolves to |

More than one full-screen view with an enabled filter warns `effects:full-screen-filters` once per crossing. A view is full-screen when the box its `Sprite`, `NineSlice` or `Shape` declares, times its `Transform.scale`, covers the viewport.

## API — `app.effects`

| Member | Behaviour |
|---|---|
| `stats()` | `{ particles, emitters, filters, renderPasses }`, a fresh object: live particles, instances plus orphans, filter instances over every view, and `renderer.stats().renderPasses` read at call time. Headless every number is 0 |

## Typed ids

`GameTypes.emitters` types `Emitter.effect` and the id of `defineEmitter`; the game's asset keys type `textures` and `Displacement.map`. `defineGame` spreads `effectsFor<Assets, EmitterIdOf<Types>>()`; the root exports accept any string.

## Headless

`renderer.host.ready()` is false: both systems return at once, no particle entity is spawned, no Pixi class is touched, `stats()` answers zeros. `onStart` still checks every definition, so a headless test catches a duplicate id. `Emitter` and every filter component are stored like any component: `snapshot()` shows `{ Emitter: { effect: "fx.steam", active: true }, "effects.glow": { strength: 2, … } }`.

## Hooks

`assets:bundle-unloaded` retires every particle instance and every `Displacement` drawn with one of its keys, whatever their space, drops their bakes, and lets the keys warn again. An effect is baked again once its bundle is back.

## Lifecycle

`onStart` resolves the four dependencies and the phone flag, registers the built-in kinds and then the `filters` of every feature, reads the `emitters`, and opens the two systems with the world hooks. `onStop` runs from state alone: it destroys every container, orphan, filter and uniform buffer and clears the filters of every view, while `world` and `renderer` still run.

## Doors

`inspect.ts` holds `game.effects` (key `effects` in `sources`) of the editor's read door, safe in a production build: it reads `stats()` every frame.

## Events

None. Nothing above `effects` needs to know a particle died or a filter was assigned; tests read `stats()`.

## Dependencies

`flow` (`features.all()`), `world` (systems, hooks, spawn and despawn, `Layer`, `Order`), `renderer` (`host.ready()`, `host.pixi()`, `host.device()`, `sync.filters.set`, `viewport.size()`, `stats()`, `Display`, `Transform`, `rootPoseOf`), `assets` (`texture(key)` and the `assets:bundle-unloaded` hook). No package dependency: every Pixi class comes from `renderer.host.pixi()`.
