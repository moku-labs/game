# P7 result

Question: can the renderer count draw calls per frame under Pixi v8 WebGPU without monkey patching?

Answer: yes, through Pixi's own extension registry. A pure read of the instruction sets is exact for everything except filters.

Research only: Pixi 8.21 source (node_modules), the 8.22.0 tarball (= `dev` HEAD), the web. Nothing was run.

## Facts

| Fact | Where (pixi.js 8.21 lib) |
|---|---|
| No draw counter, no stats, no devtools hook in 8.21 or 8.22. No issue or PR asks for one. | `utils/global/globalHooks.mjs:7,19` only hand over the instance |
| Batches and graphics call the native `drawIndexed` directly, bypassing `renderer.encoder.draw` | `GpuBatchAdaptor.mjs:55`, `GpuGraphicsAdaptor.mjs:56-85` |
| Meshes, tiling sprites, particles, filters go through `GpuEncoderSystem.draw` | `GpuEncoderSystem.mjs:217-262`, `FilterSystem.mjs:345` |
| One `Batch` instruction = exactly one draw | `BatcherPipe.mjs:69-77` |
| Instruction sets are rebuilt only on structure change and stay readable after the frame | `RenderGroupSystem.mjs:101-106` |
| Adaptors and systems are looked up by name; `extensions.remove/add` swaps them | `WebGPURenderer.mjs:41-50`, `Extensions.mjs:178-193` |
| 8.22 adds one native `pass.draw(3)` for the MSAA restore (PR #12225) | `GpuMsaaRestore.mjs:77` |
| Other engines (three.js `info.render.drawCalls`, Babylon) count at their own command layer; WebGPU has no native counter | web |

## Ways found

| Way | Touches | Accuracy |
|---|---|---|
| A. Read `renderGroup.instructionSet` after `render()` | nothing, read only | exact for sprites, text, graphics, meshes, tiling, particles, stencil masks, nested and cached groups; lower bound for filters, alpha masks, advanced blend, `customRender` |
| B. Swap `GpuBatchAdaptor`, `GpuGraphicsAdaptor`, `GpuEncoderSystem` for counting subclasses through `extensions` before `init` | Pixi's extension registry, global; internal (`@ignore`) classes | about 100% on 8.21; on 8.22 misses only the MSAA restore draw |
| C. Wrap `renderer.encoder.beginRenderPass` and each pass's `draw`/`drawIndexed` | a Pixi instance (monkey patch) | 100% |
| D. Patch `GPURenderPassEncoder.prototype` | native prototype, global (monkey patch) | 100% |

C and D are monkey patching and are out (Alex, 2026-10-03).
