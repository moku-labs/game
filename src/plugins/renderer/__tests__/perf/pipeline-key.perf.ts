import * as pixi from "pixi.js";
import { describe, expect, it } from "vitest";
import { createLazyCanvasClasses } from "../../host/render-pass";
import type { PixiModule } from "../../types";
import { createPassStage, type PassStage } from "../pass-stage";
import { bytesPerCall } from "./fixtures";

// ---------------------------------------------------------------------------
// SPIKE (item 6, 2026-11-26): the bytes of one draw's pipeline lookup. Pixi 8.22's `getPipeline` builds its cache key as
// `geometryLayout * 2^45 + …`, a number past V8's small integers, so every draw boxes one. Measured on the real Pixi
// systems over the recording stand-in of the GPU, ours and Pixi's own side by side.
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

describe("SPIKE item 6: one draw's pipeline lookup", () => {
  it("bytes per draw and per batch, ours and Pixi's own", async ({ annotate }) => {
    lazy.open();
    own.open();
    lazy.draw();
    own.draw();

    const lazyDraw = bytesPerCall(() => lazy.draw());
    const ownDraw = bytesPerCall(() => own.draw());
    const lazyBatch = bytesPerCall(() => lazy.drawBatch());
    const ownBatch = bytesPerCall(() => own.drawBatch());

    lazy.close();
    own.close();

    await annotate(
      `draw: ours ${lazyDraw} B, Pixi ${ownDraw} B; batch: ours ${lazyBatch} B, Pixi ${ownBatch} B`
    );
    expect(ownDraw).toBeGreaterThanOrEqual(0);
  });
});
