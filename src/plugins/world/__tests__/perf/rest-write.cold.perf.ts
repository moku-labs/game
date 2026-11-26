import { describe, expect, it } from "vitest";
import { allocCold } from "../../../../../tests/perf/alloc";
import { setRestFixture } from "./fixtures";

// ---------------------------------------------------------------------------
// Change 2026-11-26-f244-peek-pool, slice 1, cold tier: the `setRest` of `rest-write.perf.ts`, measured while V8 runs
// it unoptimized, as a phone runs engine code in its first seconds.
// ---------------------------------------------------------------------------

/** Bytes a call keeps outside the optimizing tiers: measured 144 B on Node 24.21 (boxed numbers), and a margin. */
const COLD_SET_REST_BYTES = 200;

describe("world: setRest of a moved plain pose, heap bytes per call, cold", () => {
  it("writes the kept rest record in place outside the optimizing tiers", async ({ annotate }) => {
    // Bug caught: a rest record or an entry built again per call in unoptimized code.
    const bytes = allocCold(setRestFixture());

    await annotate(`setRest of a moved pose, cold: ${bytes} B`);
    expect(bytes).toBeLessThanOrEqual(COLD_SET_REST_BYTES);
  });
});
