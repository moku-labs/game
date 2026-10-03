# P10 result

Question: does the planned filter model work on Pixi 8.21 under WebGPU only? The model: a `Filters` component holds plain descriptors like `{ kind: "glow", strength: 2 }`. The renderer's `sync` keeps one Filter instance per descriptor and writes numeric uniforms every frame, so a timeline can tween a uniform. Custom filters come from `defineFilter(id, { wgsl, uniforms })`. A budget gives a dev warning.

Answer: stands, with four changes. Instances are kept per view and kind, not per slot. A destroyed filter must also free its uniform buffer. `defineFilter` must check the WGSL in dev, because one bad shader blanks the whole frame. The budget counts render passes, not filters.

## Evidence

Run: `bun drive.ts`. It serves the page with Bun and opens system Chrome 154 headless through `playwright-core`, with `--enable-unsafe-webgpu`. Adapter: `apple / metal-3`, renderer `webgpu`. Canvas 1080×1920, resolution 1. Every scene has one full-screen backdrop and 10 buttons of 256 px; only the filters differ. Installed only in this directory: `pixi.js` 8.21.0, `pixi-filters` 6.1.5, `playwright-core` 1.63.0. Full numbers: `metrics.json`.

"GPU ms/frame" is wall time for 200 back-to-back renders until `queue.onSubmittedWorkDone()`, divided by 200. It is the median of 5 repeats. "Passes" is counted by patching `GPUCommandEncoder.beginRenderPass`.

### 1. A WGSL-only custom filter runs, and the uniform reaches the GPU every frame

| Check | Result |
|---|---|
| `new Filter({ gpuProgram, resources: { fu: new UniformGroup(...) } })` with no `glProgram` | renders. `compatibleRenderers` = 2, WebGPU only. No warning. |
| Same instance, `uniforms.uStrength` set to 0, 1, 2, 4 between renders, no `update()` call | pixel diff energy 0, 16 622, 18 131, 19 894 |
| `isStatic: true`, value written, no `update()` | old value stays on the GPU. After `update()` the new one shows. |
| Uploads per frame, 10 custom filters | 11 `writeBuffer` calls, 3 008 bytes. One for Pixi's globals, one per filter, every frame, changed or not. |
| Bind groups, textures, buffers created per frame in steady state | 0, 0, 0 |
| WGSL typo, a missing struct member | no JS exception. Chrome logs `struct member uMissing not found` with line and column. The pipeline is invalid, so the whole command buffer is dropped: the healthy sprite in the same frame is blank too, every frame. `GPUShaderModule.getCompilationInfo()` returns the same error before Pixi sees the source. |

The exact shape that works on 8.21:

```ts
import { Filter, GpuProgram, UniformGroup } from "pixi.js";

const source = /* wgsl */ `
struct GlobalFilterUniforms {
  uInputSize: vec4<f32>, uInputPixel: vec4<f32>, uInputClamp: vec4<f32>,
  uOutputFrame: vec4<f32>, uGlobalFrame: vec4<f32>, uOutputTexture: vec4<f32>,
};
@group(0) @binding(0) var<uniform> gfu: GlobalFilterUniforms;
@group(0) @binding(1) var uTexture: texture_2d<f32>;
@group(0) @binding(2) var uSampler: sampler;

struct VSOutput { @builtin(position) position: vec4<f32>, @location(0) uv: vec2<f32> };

@vertex
fn mainVertex(@location(0) aPosition: vec2<f32>) -> VSOutput {
  var p = aPosition * gfu.uOutputFrame.zw + gfu.uOutputFrame.xy;
  p.x = p.x * (2.0 / gfu.uOutputTexture.x) - 1.0;
  p.y = p.y * (2.0 * gfu.uOutputTexture.z / gfu.uOutputTexture.y) - gfu.uOutputTexture.z;
  return VSOutput(vec4(p, 0.0, 1.0), aPosition * (gfu.uOutputFrame.zw * gfu.uInputSize.zw));
}

struct FilterUniforms { uAmount: f32, uColor: vec3<f32> };
@group(1) @binding(0) var<uniform> fu: FilterUniforms;

@fragment
fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let c = textureSample(uTexture, uSampler, uv);
  return vec4<f32>(mix(c.rgb, fu.uColor * c.a, fu.uAmount), c.a);
}`;

const gpuProgram = GpuProgram.from({
  name: "filter-tint",
  vertex: { source, entryPoint: "mainVertex" },
  fragment: { source, entryPoint: "mainFragment" }
});

const tint = new Filter({
  gpuProgram,
  resources: {
    fu: new UniformGroup({
      uAmount: { value: 0.5, type: "f32" },
      uColor: { value: new Float32Array([1, 0, 0]), type: "vec3<f32>" }
    })
  },
  padding: 0
});

// every frame, from sync
(tint.resources.fu as UniformGroup).uniforms.uAmount = 0.8;
```

Rules from the source. Group 0 bindings 0 to 2 are filled by `FilterSystem` and must keep these names. A resource key must equal the WGSL variable name. 8.21 warns when a key matches no binding. `Filter.from({ gpu: { vertex, fragment } })` builds the same thing. The `uniforms` struct must list fields in the same order as the `UniformGroup`, so `defineFilter` generates the struct from the declaration (`filters.ts`).

### 2. Built-in filters under WebGPU only

All render: the pixel diff against no filter is above zero, and nothing is logged.

| Filter | Source | WGSL | Passes added | Padding |
|---|---|---|---|---|
| Alpha | pixi.js | yes | 2 | 0 |
| Blur, quality 4 | pixi.js | yes, generated | 9 | 2 × strength |
| ColorMatrix | pixi.js | yes | 2 | 0 |
| Displacement | pixi.js | yes | 2 | 0 |
| Noise | pixi.js | yes | 2 | 0 |
| Glow | pixi-filters 6.1.5 | yes | 2 | distance |
| Outline | pixi-filters 6.1.5 | yes | 2 | thickness |
| DropShadow | pixi-filters 6.1.5 | yes | 5 | blur + offset |
| custom glow, custom tint | `defineFilter` | only WGSL | 2 | declared |

pixi-filters 6.1.5 ships a `GpuProgram` for every filter. Its Glow reads `distance` and `quality` as uniforms in WGSL. In GLSL they are baked at construction.

### 3. Cost

| Scene | GPU ms/frame | Passes | Render CPU p95 ms | Render CPU p95, 4× throttle | Pool textures created |
|---|---|---|---|---|---|
| no filter | 0.068 | 1 | 0.1 | 0.4 | — |
| custom glow × 1 | 0.094 | 3 | 0.1 | 0.6 | 512², reused from the check |
| custom glow × 3 | 0.18 | 7 | 0.1 | 0.8 | — |
| custom glow × 10 | 0.37 | 21 | 0.2 | 1.4 | — |
| custom glow × 10, padding 48 | 0.53 | 21 | 0.2 | — | — |
| custom tint × 10, one sample | 0.325 | 21 | 0.2 | — | — |
| pixi-filters Glow × 1 / 3 / 10 | 0.122 / 0.255 / 0.675 | 3 / 7 / 21 | 0.1 / 0.1 / 0.2 | — / — / 1.0 | — |
| glow + tint list on 10 buttons | 0.472 | 31 | 0.2 | — | — |
| one glow on the parent of 10 buttons | 0.311 | 3 | 0.1 | — | 1024×1920 |
| 10 glows, `enabled = false` | 0.061 | 1 | 0.1 | — | — |
| full-screen blur × 1, quality 4 | 0.713 | 10 | 0.1 | 0.9 | 3 × 2048², 48 MB |
| full-screen blur × 3 | 2.04 | 28 | 0.2 | 0.9 | — |
| full-screen blur × 10 | 6.55 | 91 | 0.4 | 2.5 | — |
| blur quality 1 | 0.259 | 4 | 0.1 | — | — |
| blur resolution 0.5 | 0.278 | 10 | 0.1 | — | 3 × 1024², 12 MB |
| blur `repeatEdgePixels = true` | 0.689 | 10 | 0.1 | — | 3 × 1080×1920, 23.7 MB |
| blur with `filterArea` 1080×640 | 0.459 | 10 | 0.1 | — | 3 × 2048×1024, 24 MB |

- Passes: a filtered container costs 1 pass for its content plus 1 pass per filter apply. Blur applies 2 × quality times. A disabled filter costs nothing.
- A filter on a parent costs one pass set for the whole subtree. The texture covers the bounds of the whole subtree, though. 10 spread buttons gave a 1024×1920 texture, so the GPU time only drops from 0.37 to 0.31 ms.
- Padding matters for memory. The pool rounds to a power of two unless the size fits the screen. A 256 px button with padding 16 gets a 512² texture. A full-screen blur with any padding misses the screen size and gets 2048², 48 MB for its 3 textures. `repeatEdgePixels` sets padding to 0 and halves that.
- Per-pass overhead is small: 10 one-sample tints cost 0.26 ms over the base, so about 0.013 ms per pass on this GPU. Pixels touched cost the rest.
- 4× CPU throttle changes the CPU side only. GPU ms/frame stays the same. The rAF frame was 16.7 ms p95 in every scene, at the 60 Hz of headless Chrome.

### 4. Toggles and churn, 1000 frames, 10 views

| Mode | Filter instances created | `view.filters` assigned | GPU textures created | GPU buffers live, before → after | Bind groups created | Retained heap after GC | Step + render p95 ms |
|---|---|---|---|---|---|---|---|
| steady, uniforms only | 0 | 0 | 0 | 52 → 52 | 0 | +110 KB | 0.2 |
| flip `enabled` at random | 0 | 0 | 0 | 72 → 72 | 7 | +29 KB | 0.2 |
| `filters = null` ↔ `[glow]` every frame | 0 | 0 | 0 | 82 → 82 | 0 | +71 KB | 0.2 |
| random lists of 0 to 3, instances kept per view and kind | 0 | 8 299 | 0 | 102 → 102 | 638, then 175 in the next 4 000 | +127 KB | 0.3 |
| random lists, instance replaced when the kind in a slot changes | 9 918 | 8 299 | 0 | 532 → 7 741 | 7 209 | +9.5 MB | 0.5 |
| same, and the uniform buffer destroyed with the filter | 9 918 | 8 299 | 0 | 108 → 108 | 7 209 | +2.0 MB | 0.5 |

- The texture pool does not churn. Idle pool textures were 18 before and 18 after every mode.
- `Filter.destroy()` does not free the GPU buffer of its `UniformGroup`. Pixi's GC frees it after 60 to 90 s unused: 7 739 live buffers fell to 2 after 100 s of empty frames.
- The pool keeps its peak forever. After the suite, 22 idle pool textures held 127.7 MB. They were still there after 100 s, because pool textures do not take part in the GC.
- Bind group creation in the kept-instance mode is a cache filling up, not a leak. It fell from 638 per 1 000 frames to 175 per 4 000.

### 5. Is "keep the instance, write the uniform" idiomatic

Yes. Pixi's own filters do exactly that: `AlphaFilter.alpha` is a setter that writes `resources.alphaUniforms.uniforms.uAlpha`. Pixi's `Filter` doc tweens `uTime` the same way in a ticker. A non-static `UniformGroup` is synced and uploaded on every draw, so no `update()` call is needed. Two Pixi behaviours shape the `sync`:

- The `filters` setter copies and freezes the array on every assignment. Going from 0 to some filters, or back, marks the render group structure as changed. Assign only when the list of kinds changes.
- `BlurFilter.strength` recomputes `padding` on every write. With `repeatEdgePixels` the padding stays 0.

## What changes for the design

1. **`defineFilter(id, { wgsl, uniforms, padding? })` stands.** `wgsl` holds only `mainFragment` and helpers. The engine owns the header: globals, input texture, sampler, vertex stage. It also generates `struct FilterUniforms` and the `@group(1) @binding(0) var<uniform> fu` from `uniforms`, so the WGSL and the layout cannot drift. Uniform types: `f32`, `vec2<f32>`, `vec3<f32>`, `vec4<f32>`. Every one is tweenable.
2. **New: a dev WGSL check.** In dev, `defineFilter` compiles the full source once with `device.createShaderModule(...).getCompilationInfo()`. On an error it logs through `ctx.log` with line and column, and the kind renders as no filter. Without it, one typo blanks the whole screen with no exception.
3. **`sync` keeps instances per view and kind, not per slot index.** A new kind creates one instance, which lives until the view despawns. A list change reassigns `view.filters` once. Uniforms are written every frame. Kinds are matched by descriptor order, so a reorder costs one reassignment and no new instance.
4. **New: dispose frees the uniform buffers.** On despawn the renderer destroys each `UniformGroup.buffer`, then the filter. Pixi only frees them after up to 90 s. A merge game that spawns and despawns glowing items would otherwise hold thousands of buffers.
5. **The budget counts passes.** Passes per filtered view = 1 + the sum of each filter's passes. Most filters take 1. Blur takes 2 × quality. DropShadow at its default quality takes 4 applies, 5 passes with its content pass. Each class can declare its count. The renderer can compute this from the kinds without asking the GPU. Proposed dev warnings: more than 24 filter passes in a frame, and more than one full-screen filter. These limits are a guess until P1's phone question is answered.
6. **Defaults for a full-screen backdrop blur:** `repeatEdgePixels: true`, quality 2, and resolution 0.5 on a phone. Quality 1 costs 0.26 ms against 0.71 ms at quality 4. Resolution 0.5 costs 0.28 ms.
7. **Pool memory.** Pool textures stay at their peak, 48 MB for a single padded full-screen blur. The renderer should call `TexturePool.clear()` on a scene change. Not measured yet.
8. **pixi-filters is usable WebGPU-only.** Built-in kinds `outline` and `dropShadow` can map to it with no shader of ours. For glow, our custom filter is cheaper: 0.37 against 0.675 ms for 10. Whether pixi-filters becomes a dependency is a separate decision. It is `sideEffects: false`.

## What was NOT measured

- No phone. All numbers come from an Apple-silicon desktop GPU in headless Chrome at 60 Hz. A phone GPU has much less fill rate, and full-screen blur cost scales with pixels.
- Throughput is wall time to `onSubmittedWorkDone`. GPU timestamp queries were not used.
- JS garbage per frame. Only the heap retained after a forced GC was measured.
- `TexturePool.clear()` on a scene change, `blendRequired` filters with their back-texture copy, `resolution: "inherit"` at DPR 3, antialiased filters, and filters inside `cacheAsTexture` or render groups.
- The instruction rebuild cost after a `filters` 0 ↔ n change in a large scene. The test scene had 11 sprites.
