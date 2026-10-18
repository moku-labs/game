import * as pixi from "pixi.js";
import { describe, expect, it } from "vitest";
import { createLazyCanvasClasses } from "../../host/render-pass";
import type { PixiModule } from "../../types";
import { createPassStage, type PassStage } from "../pass-stage";
import { BUDGET, NOISE } from "./budgets";
import { bytesPerCall } from "./fixtures";

// ---------------------------------------------------------------------------
// Perf: the lazy canvas pass (B3 of change 2026-10-18-memory-render) over the real pixi.js systems on the recording
// stand-in of the GPU, quiet: a deferred bind of the canvas allocates nothing, the pipeline hook adds nothing to Pixi's
// own draw and batch, and a frame that starts with a filter allocates no more than Pixi's own frame. Pixi's own
// systems on a second stage are the baseline of the last two.
// ---------------------------------------------------------------------------

/** The lazy classes over the real module. */
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

/**
 * One frame of the memory screen's shape on a stage: a filter first, then its apply on the canvas.
 *
 * @param stage - The stage.
 * @returns The frame.
 */
function filterFirst(stage: PassStage): () => void {
  return () => {
    stage.frame(() => stage.withFilter(stage.draw));
  };
}

describe("the lazy canvas pass", () => {
  it("defers a bind of the canvas without allocating", () => {
    lazy.open();
    lazy.withFilter(lazy.draw);

    const bytes = bytesPerCall(() => lazy.bindCanvas());

    lazy.close();

    expect(bytes).toBeLessThanOrEqual(BUDGET.lazyCanvasBind + NOISE);
  });

  it("adds nothing to the bytes of Pixi's own draw and batch", () => {
    lazy.open();
    own.open();
    lazy.draw();
    own.draw();

    const draw = bytesPerCall(() => lazy.draw()) - bytesPerCall(() => own.draw());
    const batch = bytesPerCall(() => lazy.drawBatch()) - bytesPerCall(() => own.drawBatch());

    lazy.close();
    own.close();

    expect(draw).toBeLessThanOrEqual(BUDGET.lazyCanvasDraw + NOISE);
    expect(batch).toBeLessThanOrEqual(BUDGET.lazyCanvasDraw + NOISE);
  });

  it("allocates no more in a frame that starts with a filter than Pixi's own frame", () => {
    const added = bytesPerCall(filterFirst(lazy)) - bytesPerCall(filterFirst(own));

    expect(added).toBeLessThanOrEqual(BUDGET.lazyCanvasFrame + NOISE);
  });
});
