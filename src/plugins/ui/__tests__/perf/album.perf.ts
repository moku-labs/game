import { describe, expect, it } from "vitest";
import { alloc } from "../../../../../tests/perf/alloc";
import { type AlbumPerf, startAlbumPerf } from "./album.fixture";

// ---------------------------------------------------------------------------
// Change 2026-11-26-f244-album-swipe: a turn of the album's set page, the two pages of the strip swapped and the wide
// dot moved, reconciled, solved and entered over a root of 572 elements. Measured on Node 24.21, warm:
//   before the change   841 826 B a turn: every element of the root, the 312 of the overview that stand included,
//                       got a new rect, a new frame and a new rest pose at the solve; each of the 256 elements of the
//                       two pages, moved with its page only, wrote its rest and its visual again
//   now                 157 734 B: the solve reads only the nodes Yoga laid out again, a subtree that stands relative
//                       to its parent is moved by the parent's step, the application walks only what the solve
//                       stamped, and an element that slid with its parent writes its `Box` alone. What is left grows
//                       with the elements that really changed: the new rect of each of the 256 slid elements, the 0 ms
//                       rest tracks of the poses that moved (the pages, the dots) and the restyled dots
// ---------------------------------------------------------------------------

/** Calls of a window: a turn walks the whole root, ~1.3 ms; `alloc` warms it 5 000 times first. */
const CALLS = 200;

/** The bytes a turn may keep: the measured 157 734 B and a margin, far under the 841 826 B of a whole-root apply. */
const TURN_BYTES = 180_000;

/**
 * The x of a keyed element's rect.
 *
 * @param perf - The started album perf app.
 * @param key - The element key.
 * @returns Its x in root coordinates.
 */
function xOf(perf: AlbumPerf, key: string): number | undefined {
  return perf.ui.app.ui.rectOf({ projection: "album", key })?.x;
}

describe("ui: a turn of the album's set page, heap per turn", () => {
  it("swaps the two pages and allocates nothing for the elements that stand", async ({
    annotate
  }) => {
    const perf = await startAlbumPerf();
    const shown = xOf(perf, "albumPage0");

    // A turn brings set 1 to where set 0 stood, and back.
    perf.turn();
    expect(xOf(perf, "albumPage1")).toBe(shown);
    perf.turn();
    expect(xOf(perf, "albumPage0")).toBe(shown);

    const bytes = alloc(perf.turn, CALLS);

    await annotate(`a turn of ${perf.elements} elements: ${bytes} B`);
    expect(bytes).toBeLessThanOrEqual(TURN_BYTES);

    await perf.ui.app.stop();
  });
});
