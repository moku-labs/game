import * as pixi from "pixi.js";
import { describe, expect, it } from "vitest";
import { createLazyCanvasClasses } from "../../host/render-pass";
import type { PixiModule } from "../../types";
import { createPassStage, type PassStage } from "../pass-stage";
import { BUDGET, NOISE } from "./budgets";
import { bytesPerCall } from "./fixtures";

// ---------------------------------------------------------------------------
// Perf: one draw's pipeline lookup (item 6). Bug it guards: a draw that boxes a pipeline key again. Pixi 8.22's own
// `getPipeline` keys its cache with `geometryLayout * 2^45 + …`, past V8's small integers, so it boxes one per draw
// (16 B; ~27 MB over the A26 walk of «A Memory Missing»). Measured on the real Pixi systems over the recording stand-in
// of the GPU, ours whole, Pixi's own beside it for the record.
// ---------------------------------------------------------------------------

const classes = createLazyCanvasClasses(pixi as unknown as PixiModule);

/**
 * A stage that records nothing, so a window counts the systems' bytes alone.
 *
 * @param stage - The stage.
 * @returns The same stage, quiet.
 */
function quiet(stage: PassStage): PassStage {
  stage.gpu.record = false;

  return stage;
}

const lazy = quiet(createPassStage({ targets: classes.targets, pipeline: classes.pipeline }));
const own = quiet(
  createPassStage({ targets: pixi.GpuRenderTargetSystem, pipeline: pixi.PipelineSystem })
);

describe("one draw's pipeline lookup", () => {
  it("allocates nothing per draw and per batch, where Pixi's own boxes its key", async ({
    annotate
  }) => {
    lazy.open();
    own.open();
    lazy.draw();
    own.draw();

    const draw = bytesPerCall(() => lazy.draw());
    const batch = bytesPerCall(() => lazy.drawBatch());
    const pixiDraw = bytesPerCall(() => own.draw());

    lazy.close();
    own.close();

    await annotate(`draw ${draw} B, batch ${batch} B; Pixi's own draw ${pixiDraw} B`);
    expect(draw).toBeLessThanOrEqual(BUDGET.pipelineDraw + NOISE);
    expect(batch).toBeLessThanOrEqual(BUDGET.pipelineDraw + NOISE);
  });
});
