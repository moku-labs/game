# P9 result

Question: can our own thin emitter on Pixi 8.21 `ParticleContainer` + `Particle`, stepped by our own clock with no Pixi ticker, carry merge-game effects on a phone?

Answer: stands. The emitter works and a merge effect costs about 0.1 ms per frame. Three beliefs about the API change: the `dynamicProperties` keys, what "static" buys, and how strict "one texture source" is.

## Evidence

Setup: `bun measure.ts`. Pixi 8.21.0 on `webgpu`, Chrome 154 headed through `playwright-core`, Apple M4 Pro, 120 Hz display. The page is phone-shaped: 390 × 844 CSS px at DPR 3, so the canvas is 1170 × 2532. Renderer from `autoDetectRenderer`, no `Application`, no ticker. Our rAF loop calls `emitter.step(dtMs)` and then `renderer.render(stage)`. The page is cross-origin isolated, so `performance.now()` has 5 µs steps. An 81-sprite board sits under the particles. Full numbers: `metrics.json`. A second run: `metrics-previous-run.json`.

CPU throttle 4x and 6x is CDP `Emulation.setCPUThrottlingRate`. It is a stand-in for a mid-range Android, not a phone. It slows only the page main thread. The GPU, the GPU process and the compositor run at full Mac speed.

### API, read in `node_modules/pixi.js` 8.21.0

| Belief | Source says | Verdict |
|---|---|---|
| Particle is a light data object, no children | Plain class: `x, y, scaleX, scaleY, anchorX, anchorY, rotation, color, texture`. `tint` and `alpha` are setters that write the packed `color`. `ParticleContainer.addChild` throws | holds. Anchor default is 0, the top-left corner |
| `dynamicProperties {position, scale, rotation, color, vertex}` | Keys are `vertex, position, rotation, uvs, color`. No `scale` key. Scale, anchor and frame size live in `vertex`. `uvs` is the texture frame | changes |
| Default: only position dynamic | `{ position: true }`, the rest false. Read once in the constructor, fixed after | holds |
| Static is cheap | Static attributes upload when `_childrenDirty`. `addParticle`, `removeParticle` and `update()` set it. An emitter that spawns or retires a particle in a frame uploads everything that frame | changes |
| One shared texture source | The container binds ONE texture: `container.texture`, or the first particle's texture at first render. Other sources are sampled from that one page. No error, no warning | holds, stricter |
| `boundsArea` | `bounds` is always empty `(0,0,0,0)`. `getBounds()` returns `boundsArea` when set | see culling |
| Culling | `cullable = true` without `boundsArea`: always culled, even on screen | trap |
| "Experimental" | Only a JSDoc banner on the class: "This is a new API, things may change". No runtime flag. `shader` option is `@advanced` | note |
| Batching | `addRenderable` calls `batch.break`. A ParticleContainer is always its own draw call | see Q5 |
| Upload code | Generated with `new Function`. A CSP without `unsafe-eval` needs `import "pixi.js/unsafe-eval"`, which has a particle polyfill | note |
| `removeParticle` | `indexOf` + `splice`, O(n) per particle | trap |

### Load: JS frame time, p95 ms

JS frame = `emitter.step` + `renderer.render`. Two runs: this run · previous run. The render call is mostly Pixi packing the vertex buffers on the CPU. Particles are 19 CSS px. Lifetime 1.5 to 2.5 s, so about 1/2 of the count spawns and dies every second.

| Dynamic | Live | 1x step / render p95 | 1x JS frame p95 | 4x JS frame p95 | 6x JS frame p95 | 6x step / render p95 | 4x / 6x frames over 17.5 ms |
|---|---|---|---|---|---|---|---|
| position | 1000 | 0.19 / 0.64 | 0.8 · 0.51 | 1.1 · 1.24 | 1.62 · 2.14 | 0.39 / 1.55 | 0 % / 0 % |
| position | 5000 | 0.7 / 1.08 | 1.68 · 0.64 | 2.5 · 2.26 | 5.67 · 3.43 | 1.95 / 4.3 | 0 % / 0 % |
| position | 20000 | 0.89 / 1.58 | 2.34 · 1.93 | 7.61 · 18.8 | 28.14 · 18.94 | 8.08 / 20.64 | 0 % / 61 % |
| position | 50000 | 2.03 / 2.29 | 4.17 · 3.47 | 23.74 · 33.67 | 47.05 · 47.88 | 15.85 / 32.27 | 21 % / 85 % |
| full | 1000 | 0.36 / 0.76 | 1.02 · 0.72 | 0.86 · 1.25 | 1.41 · 2.1 | 0.38 / 1.32 | 0 % / 0 % |
| full | 5000 | 1.14 / 1.35 | 2.34 · 2.06 | 2.96 · 2.81 | 4.18 · 5.6 | 1.56 / 2.94 | 0 % / 0 % |
| full | 20000 | 0.84 / 1.59 | 2.32 · 2.06 | 6.97 · 18 | 15.04 · 16.63 | 5.17 / 10.89 | 0 % / 5 % |
| full | 50000 | 2 / 2.28 | 4.11 · 5.59 | 22.41 · 34.75 | 48.21 · 65.96 | 19.31 / 30.84 | 14 % / 95 % |
| position, no churn | 1000 | 0.38 / 0.5 | 0.9 · 0.52 | 0.76 · 0.72 | 1.4 · 1.37 | 0.06 / 1.3 | 0 % / 0 % |
| position, no churn | 5000 | 1.26 / 0.63 | 1.72 · 1.44 | 2.37 · 2.03 | 1.38 · 4.39 | 0.33 / 1.32 | 0 % / 0 % |
| position, no churn | 20000 | 0.91 / 0.93 | 1.75 · 1.88 | 8.96 · 8.04 | 3.38 · 14.71 | 1.33 / 2.76 | 0 % / 0 % |
| position, no churn | 50000 | 0.95 / 1.13 | 2.01 · 2.34 | 6.01 · 5.99 | 6.94 · 16.24 | 2.58 / 4.87 | 0 % / 0 % |

- `position` = only position dynamic, no over-life curves. `full` = position, vertex, rotation and color dynamic, with scale, alpha and tint curves and spin. `no churn` = a fixed set that never spawns or dies.
- With churn, `position` and `full` cost the same. At 50k, 1x: render 1.77 vs 1.60 ms p50. Static saves only when nothing spawns or dies: 0.90 ms p50.
- 20k under throttle moved by 2x between the two runs. Read the 20k rows as "at the edge", not as a number.

### Fill rate: the same counts with 64 CSS px particles, 1x

| Dynamic | Live | JS frame p95 | rAF delta p95 | submit to GPU done p50 |
|---|---|---|---|---|
| position | 5000 | 1.71 | 9.31 | 3.12 |
| position | 20000 | 2.26 | 9.04 | 8.35 |
| full | 5000 | 2.19 | 8.99 | 3.24 |
| full | 20000 | 3.62 | 17.07 | 52.98 |

20k large additive particles on 1170 × 2532 already miss frames on an M4 Pro GPU. On a phone GPU the wall is far lower. Size and overdraw limit effects before the JS does.

### Merge effect: 3 bursts × 40 stars, every second

Ring shape, lifetime 600 to 900 ms, gravity, drag, spin, scale, alpha and tint curves, two texture variants. 600 frames per throttle.

| CPU throttle | Live while busy | Spawn of 120, p95 ms | Step p50 / mean ms | Render call busy / idle, mean ms | rAF delta p95 |
|---|---|---|---|---|---|
| 1x | 120 | 0.27 | 0.02 / 0.03 | 0.27 / 0.23 | 8.88 |
| 4x | 120 | 0.05 | 0.01 / 0.02 | 0.40 / 0.35 | 9.18 |
| 6x | 120 | 0.20 | 0 / 0.02 | 0.22 / 0.17 | 9.26 |

Cost per frame: about 0.05 ms render + 0.03 ms step. The spawn frame adds up to 0.3 ms. Plus one draw call.

### Q5: draw order and batching

Scene: red sprite s1, then a ParticleContainer with one 128 px green particle across the s1/s2 seam, then blue sprite s2 and red sprite s3. Draw calls counted on `GPURenderPassEncoder`. Colors are mean RGB of 32 × 32 px regions.

| Variant | Draw calls | Region s1 + particle | Region particle + s2 | Page-B particle in a page-A container |
|---|---|---|---|---|
| sprites only | 1 | 224,48,48 red | 48,80,224 blue | none |
| container, particle from another page | 3 | 0,255,0 green | 48,80,224 blue | none |
| container, particle from the sprites' page | 3 | 0,80,0 green | 48,80,224 blue | none |
| container, mixed sources | 3 | 0,255,0 green | 48,80,224 blue | 77,77,77 gray, expected red |

- Sibling order works. The particle is drawn over s1 and under s2.
- The atlas page does not matter for batching. The container always splits the sprite batch: 1 draw becomes 3.
- A particle from a second source draws garbage from the first page, silently.

### Correctness

- ParticleContainer vs the same state drawn by plain `Sprite`s: 0 differing pixels at 6 checkpoints, for `full` and for `position`. Two renders of one state: 0 differing pixels.
- Thin lines appeared in the first screenshots. Cause: our test atlas had a solid frame touching the diamond frame, and linear sampling at the frame edge read the neighbour. Sprites showed the same lines. Fixed by an empty frame between them. Effect atlases need padding.
- `shots/bursts.png`, `shots/load-full-5k.png`: read by the agent, not by a person.

### Small costs, 50k particles, mean ms

| CPU throttle | `tint` + `alpha` setters | Write packed `color` | `removeParticle` 200 of 20k | Swap-remove 200 + `update()` |
|---|---|---|---|---|
| 1x | 0.73 | 0.09 | 0.30 | 0.02 |
| 4x | 2.02 | 0.38 | 0.83 | 0.01 |
| 6x | 3.16 | 0.89 | 2.22 | 0 |

## What changes for the design

- The emitter owns `container.particleChildren`. It retires by swap-remove and calls `update()` once per step when anything spawned or died. It never calls `addParticle` or `removeParticle` per particle.
- Pool every `Particle` at creation with `anchorX = anchorY = 0.5`. Write `p.color` directly as ABGR. Bake curves into 64-entry tables at config time.
- One dynamic set for emitters: `{ position, vertex, rotation, color }`. It costs the same as position-only once particles churn. `uvs` stays static: the frame is set at spawn and covered by the same `update()`. Keep position-only only for a fixed set that never churns, or drop that mode.
- `dynamicProperties` is typed `Record<string, boolean>` in our code. Pixi's type `ParticleProperties & Record<string, boolean>` rejects a `ParticleProperties` value under `exactOptionalPropertyTypes`.
- One ParticleContainer per layer per atlas page. The effect config names its atlas. At config time we check that every texture shares one `source` and report through `ctx.log`. Pixi does not check.
- The engine never sets `cullable` on a ParticleContainer without `boundsArea`. Either skip particle layers in culling or set `boundsArea` to the effect's area.
- A particle layer is a normal sibling in draw order. Each one costs a draw call and splits the sprite batch around it. Put effect layers between sprite layers, not inside a sprite run. Bursts share one container per layer; never one container per burst.
- Budget for a phone: a hard `maxParticles` per container and a global cap in the low thousands. Under the 4x and 6x stand-in, 5k live costs 3 to 6 ms p95 and 20k breaks 60 Hz. A merge burst of 120 costs about 0.1 ms.
- Keep particles small. Fill rate hits first: 20k particles at 64 CSS px miss frames on a desktop GPU.
- The effect atlas is packed with padding or extrude, 2 px or more.
- If the app ships a CSP without `unsafe-eval`, the renderer imports `pixi.js/unsafe-eval`.
- No ticker is needed. `autoDetectRenderer` plus our clock is enough. The rate spawner keeps a fractional carry, so 60 Hz and 120 Hz emit the same count. Each emitter has its own seeded RNG, apart from game RNG.

## What was NOT measured

- A real phone. No Android, no iPhone. CPU throttling is a stand-in: it does not slow the GPU, the GPU process, memory bandwidth or thermals.
- GPU time itself. "Submit to GPU done" is the latency of `onSubmittedWorkDone`; under throttling it includes main-thread delay.
- Fill rate of Adreno or Mali GPUs. This is the likely limit on a phone.
- Safari or WKWebView WebGPU, and the WebGL path.
- GC pauses and memory over a long session. Pixi's particle buffer grows by 1.5x and never shrinks.
- Several particle containers in one frame, blend modes other than `add`, custom particle shaders.
- Run-to-run spread beyond two runs. The 20k throttled rows differ by up to 2x between them.
- A person looking at the effects in motion.
