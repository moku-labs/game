import { describe, expect, it } from "vitest";
import { alloc } from "../../../../../tests/perf/alloc";
import { NOISE_BYTES } from "./budgets";
import { setRestFixture } from "./fixtures";

// ---------------------------------------------------------------------------
// Change 2026-11-26-f244-peek-pool, slice 1, step 6: `projection.setRest` of a plain pose that moved writes the
// entity's kept rest record in place, field by field by name. Before the change every call built
// `{ ...defaults, ...value }` and a new entry for it. Measured on Node 24.21, warm: 0 B.
// ---------------------------------------------------------------------------

describe("world: setRest of a moved plain pose, heap bytes per call", () => {
  it("writes the kept rest record in place and keeps nothing", async ({ annotate }) => {
    // Bug caught: a rest record built again per call, or a number boxed by a write through a key.
    const bytes = alloc(setRestFixture());

    await annotate(`setRest of a moved pose: ${bytes} B`);
    expect(bytes).toBeLessThanOrEqual(NOISE_BYTES);
  });
});
