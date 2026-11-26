import { afterEach, describe, expect, it } from "vitest";
import { alloc } from "../../../../../tests/perf/alloc";
import { type AlbumPerf, startAlbumPerf } from "./album.fixture";

// ---------------------------------------------------------------------------
// Change 2026-11-26-f244-album-swipe: a turn of the album's set page, the two pages of the strip swapped and the wide
// dot moved, reconciled, solved and entered over a root of 572 elements. Measured on Node 24.21, warm:
//   before the change   841 826 B a turn: every element of the root, the 312 of the overview that stand included,
//                       got a new rect, a new frame and a new rest pose at the solve; each of the 256 elements of the
//                       two pages, moved with its page only, wrote its rest and its visual again
//   now                 141 676 B: the solve reads only the nodes Yoga laid out again, a subtree that stands relative
//                       to its parent is moved by the parent's step on the element's two kept rects, the application
//                       walks only what the solve stamped, and an element that slid with its parent writes its `Box`
//                       alone. What is left grows with what really changed, not with the root: the 8 rest poses that
//                       moved (the two pages, the dots) and their 0 ms rest tracks, the restyled dots, and the `Box`
//                       writes of the 256 slid elements
// ---------------------------------------------------------------------------

/** Calls of a window: a turn walks the whole root, ~1.1 ms; `alloc` warms it 5 000 times first. */
const CALLS = 200;

/** The bytes a turn may keep: the measured 141 676 B and a margin, far under the 841 826 B of a whole-root apply. */
const TURN_BYTES = 160_000;

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

/** The app of the running test, stopped after it, also when an assertion fails. */
let running: AlbumPerf | undefined;

afterEach(async () => {
  await running?.ui.app.stop();
  running = undefined;
});

describe("ui: a turn of the album's set page, heap per turn", () => {
  it("swaps the two pages and keeps a turn under the budget of the elements that changed", async ({
    annotate
  }) => {
    // Bug caught: a solve that places and applies every element of the root again, the 312 that
    // stand included, keeps ~840 KB a turn and hands the phone a GC every few turns.
    const perf = await startAlbumPerf();

    running = perf;

    const shown = xOf(perf, "albumPage0");

    // A turn brings set 1 to where set 0 stood, and back.
    perf.turn();
    expect(xOf(perf, "albumPage1")).toBe(shown);
    perf.turn();
    expect(xOf(perf, "albumPage0")).toBe(shown);

    const bytes = alloc(perf.turn, CALLS);

    await annotate(`a turn of ${perf.elements} elements: ${bytes} B`);
    expect(bytes).toBeLessThanOrEqual(TURN_BYTES);
  });
});
