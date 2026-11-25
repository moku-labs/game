import { describe, expect, it } from "vitest";
import { allocCold } from "../../../../../tests/perf/alloc";
import { renderPassesOf } from "../../sync/filters";
import type { PixiFilter } from "../../types";
import { FakeFilter } from "../fake-pixi";
import type { MockRenderer } from "../mock-renderer";
import { startSprites } from "./fixtures";

// ---------------------------------------------------------------------------
// Cold perf (change 2026-11-24-f230-hot-path, R1): what the count of the render passes allocates while V8 runs it in
// the interpreter or the baseline tier (`--max-opt=1`), as a phone runs it in its first seconds. The count walks the
// filters of 10 filtered views (`countFiltered`, `addFiltered`, `passesOf`); `passesVersion` moves before every call,
// so the full walk runs, as it does in a frame where a filter was written. A `for…of` over a slot list costs an
// iterator and its result objects there; an index loop costs none.
// Measured on Node 24.21, 10 filtered views of one filter each:
//   renderPassesOf before R1       2560 B per call
//   renderPassesOf after R1           0 B per call
// ---------------------------------------------------------------------------

/** What `renderPassesOf` costs after R1, cold, with `passesVersion` moved, 10 filtered views, plus 16 B of margin. */
const RENDER_PASSES_COLD = 16;

/**
 * A still stage of 10 filtered sprites among 40, each with one filter of one apply, hung through the seam `effects`
 * uses. The pass that builds them has run, every change set is cleared.
 *
 * @returns The started renderer.
 */
async function tenFiltered(): Promise<MockRenderer> {
  const { mock, entities } = await startSprites(40);

  for (let index = 0; index < 10; index += 1) {
    const filter = new FakeFilter() as unknown as PixiFilter;

    mock.api.sync.filters.set(entities[index * 4] ?? 0, [{ filter, passes: 1, kind: "fog" }]);
  }

  mock.modules.sync.pass();
  mock.world.clearChanges();

  return mock;
}

describe("renderPassesOf, run unoptimized", () => {
  it("counts the passes of 10 filtered views, the count taken again, within its budget", async () => {
    const mock = await tenFiltered();
    const { sync } = mock.ctx.state;
    const { kept } = mock.ctx.state;

    expect(renderPassesOf(sync, kept)).toBe(21);
    expect(
      allocCold(() => {
        sync.passesVersion += 1;
        renderPassesOf(sync, kept);
      })
    ).toBeLessThanOrEqual(RENDER_PASSES_COLD);
  });
});
