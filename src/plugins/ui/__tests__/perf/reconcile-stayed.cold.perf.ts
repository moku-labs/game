import { describe, expect, it } from "vitest";
import { allocCold } from "../../../../../tests/perf/alloc";
import { startStayedPerf } from "./reconcile-stayed.fixture";

// ---------------------------------------------------------------------------
// Cold perf (change 2026-11-24-f230-hot-path, U2 and U3): `ui.reconcile` and `ui.solve` of the stayed root, 108
// elements, handed the other of two prebuilt equal trees at every call, while V8 runs the code unoptimized
// (`--max-opt=1`), as a phone runs it in its first seconds. Measured on Node 24.21:
//   before the change          279 238 B a render (the identities, the child lists, sets and iterators of the diff,
//                                         the flags and change objects of every compare, the key lists of `sameValue`)
//   after U2                     4 355 B
//   after U3                     1 819 B: the walks of the solve's `layOutRoots`, the range, scroll and remeasure
//                                         steps, the sweep and the fields (iterators outside U3's list), the
//                                         changed read of `dirtyRoots` (world's API) and Yoga's getters
// ---------------------------------------------------------------------------

/** Calls of a window: a call kept kilobytes before the change, so the window stays inside the young generation. */
const CALLS = 200;

/** What a render costs cold now, 1 819 B, with room for the noise of unoptimized code: far under the 279 238 B before. */
const STAYED_COLD = 2200;

describe("ui reconcile of a root whose elements all stayed, run unoptimized", () => {
  it("stays below what it cost before the change", async ({ annotate }) => {
    const perf = await startStayedPerf();
    const bytes = allocCold(perf.stayed, CALLS);

    await annotate(`reconcile + solve, 108 elements stayed, cold: ${bytes} B a render`);
    expect(bytes).toBeLessThanOrEqual(STAYED_COLD);

    await perf.ui.app.stop();
  });
});
