import * as pixi from "pixi.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Shape, Transform } from "../../components";
import { KEY } from "../../kept/geometry";
import { type Drawn, startDrawn } from "../demand-harness";

// ---------------------------------------------------------------------------
// A kept view stretched on one axis (F179) over the real Pixi of `stagePixi`: the picture follows Pixi's full matrix,
// so a view of `scaleX: 0.5` is recorded and redrawn at half width and full height. The tree oracle and the picture
// oracle check every frame.
// ---------------------------------------------------------------------------

const running: Drawn[] = [];

afterEach(() => {
  for (const drawn of running.splice(0)) {
    drawn.oracle.expectNoMissedFrame();
    drawn.oracle.expectPicturesCurrent();
    drawn.mock.stop();
  }

  vi.restoreAllMocks();
});

describe("a kept view of scaleX 0.5", () => {
  // Bug: the picture is taken at the uniform scale, so the ribbon is redrawn at full width.
  it("records and redraws at half width and full height", async () => {
    const drawn = await startDrawn({ onDemand: false });

    running.push(drawn);

    const card = drawn.spawn(Transform({ x: 100, y: 100, scaleX: 0.5 }), Shape({ w: 40, h: 40 }));

    drawn.frame();
    drawn.mock.api.sync.filters.set(card, [
      { filter: new pixi.AlphaFilter({ alpha: 0.5 }), passes: 1, cache: "local" }
    ]);
    drawn.frames(4);

    const record = drawn.mock.ctx.state.kept.byEntity.get(card);

    expect(record?.mode).toBe("kept");
    expect(record?.key[KEY.a]).toBeCloseTo(0.5);
    expect(record?.key[KEY.d]).toBeCloseTo(1);
  });
});
