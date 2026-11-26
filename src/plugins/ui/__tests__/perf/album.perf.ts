import { afterEach, describe, expect, it } from "vitest";
import { alloc } from "../../../../../tests/perf/alloc";
import type { DescriptionNode } from "../../jsx/types";
import { ALBUM } from "./album";
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
// Change 2026-11-26-f244-peek-pool, slice 1: a turn now runs the frame step of phase `animate` first, which ends the
// 0 ms rest tracks of the turn before, as every real frame does (without it each turn kept its 8 tracks in anim's
// list). Measured on Node 24.21, warm, with that step:
//   before the change   139 360 B a turn
//   now                 22 512 to 23 638 B: the closures of `repose` and `change.Box` are gone, the 8 rest tracks
//                       start from kept records through kept handles, options and targets, the bases and owners stay
//                       in their tables, rest poses and the `Shape` of an element are written in place, a resolved
//                       style is kept per style object, and a rect is written into `Box` by name. What is left, by
//                       the heap profile: the new rest pose `restTransform` builds per moved element, Yoga's wrappers
//                       (yoga-layout), the visual and input values of the restyled dots and the title text, the
//                       `Animation` count added and removed per track through the ECS commands, and the table of
//                       running tracks, whose ids are new at every start. Not yet 0: the remainder is named in the
//                       report of the change, not hidden here.
//   then                14 582 B: a rest pose with no `change.Transform` hook is written into the element's own
//                       record (a count of its moves replaces its identity), its pivot kept while it stands; the
//                       rest a commit records is one kept record; a plain pose is written into the world's kept rest
//                       by name, a field only when it moved; the patches and rest values of a restyle are written
//                       into records kept per component; the input values of an element are kept while their props
//                       stand; a short child list is searched with no set; the layout takes a child out through the
//                       handles it inserted, not a new handle per `getChild`; and a node keeps its measure function
//                       while its element stands. Left, by the heap profile: yoga-layout's argument copies of
//                       `setWidth`/`setPosition` (4 and 2 calls a turn) and Emscripten's call wrappers; the
//                       `Animation` added and removed per rest track through the ECS commands and the store's Map;
//                       the patch walk of the reconciler; the boxes of the doubles written into kept records.
//   then                8 793 B (8 033 B in a second window): a changed element marks its style basis stale in place
//                       (a `delete` and a new basis object per patch before); two keyed siblings that swap take the
//                       identity strings their elements keep; a node with no `components` and a component nobody
//                       listens to build no empty list; the ECS keeps its applied `add` and `remove` commands and the
//                       emptied batches of a flush; anim finds a running track by id in its start-ordered list, not in a
//                       `Map` whose ids are new at every start; the repose of a restyle takes the pivot its commit made;
//                       a text keeps its `Text` value; a number in a layout field is compared without `JSON.stringify`;
//                       no iterator walks an empty set of exits or of fields, nor the list of scrolls. Of the 8 793 B,
//                       by the heap profile: yoga-layout's own frames ~2 790 B (`YOGA_BYTES`), the 8 handles 384 B
//                       (`HANDLE_BYTES`), and the engine's ~5 620 B (`TURN_BYTES`): the boxes of doubles read and
//                       written through keys (the rest values of the restyled dots in `writeRest`, the rest track's
//                       target and start values in `numericInto`, `othersOf`, `beginTrack`, the track's patch and
//                       `Object.assign`), the table V8 grows and shrinks for the store of `Animation` (its 8 entities
//                       go and come back every turn), the copy of each `Animation` value added, the 6 new pivots of
//                       the dots whose size moved, and the arguments boxed for the wrapped Yoga setters.
// ---------------------------------------------------------------------------

/** Calls of a window: a turn walks the whole root, ~1.1 ms; `alloc` warms it 5 000 times first. */
const CALLS = 200;

/**
 * The engine's own bytes a turn may keep, the handles and Yoga's bytes left out: the measured ~5 620 B and a margin,
 * far under the 139 360 B before the change. Not 0: what is left is named in the comment above.
 */
const TURN_BYTES = 6400;

/**
 * The bytes of the handles a turn's rest tracks hand their caller: one small object per started track, 8 tracks, 48 B
 * each, measured by `anim/__tests__/perf/rest-track.perf.ts`. A hook may keep a handle, so it is not pooled.
 */
const HANDLE_BYTES = 8 * 48;

/**
 * The bytes of a turn made inside yoga-layout: its `wrapAssembly` wrapper of `setWidth` and `setPosition` (4 and 2
 * calls a turn) copies its arguments into two arrays and calls through two spreads, and embind's own glue keeps some
 * for `insertChild` and `removeChild` (2 each). The heap profile of a turn puts ~2 790 B in yoga-layout's frames;
 * `yoga-calls.perf.ts` measures each call alone. The wrapped method is kept in the wrapper's closure: no call of the
 * engine can reach it, and a reorder or a resize of a node has no other call.
 */
const YOGA_BYTES = 2800;

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
    expect(bytes).toBeLessThanOrEqual(TURN_BYTES + HANDLE_BYTES + YOGA_BYTES);
  });
});

describe("ui: the album's page beside, built in parts behind the clip (spec 33 G), heap per frame", () => {
  it("keeps nothing in a frame while the build is open and in the steady frame after its finish", async ({
    annotate
  }) => {
    // Bug caught: the meet test of an open build (the drawn poses of the page and its clip, every frame until the
    // pager brings the page in) or the field reads of the gate allocate per frame, a GC on the phone every few seconds
    // while the album rests.
    const perf = await startAlbumPerf();

    running = perf;

    const peek = ALBUM.peek[1] as DescriptionNode;

    // The peek's commit parks the page beside; four frames make its parts; the build stays open, out of the clip.
    perf.render(peek);

    for (let frame = 0; frame < 5; frame += 1) perf.ui.app.time.step(16);

    const open = alloc(perf.rest);

    // A commit of the same tree finishes the build before its diff; then the root rests.
    perf.render(peek);

    for (let frame = 0; frame < 5; frame += 1) perf.ui.app.time.step(16);

    const steady = alloc(perf.rest);

    await annotate(
      `a frame with the build open: ${open} B; the steady frame after it: ${steady} B`
    );
    expect(open).toBe(0);
    expect(steady).toBe(0);
  });
});
