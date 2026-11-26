import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import { albumTree } from "./album";
import { startAlbumPerf } from "./album.fixture";

const turns = await startAlbumPerf();
const swipes = await startAlbumPerf();
const turnWalks = await startAlbumPerf();
const peekWalks = await startAlbumPerf();
const wholeSwipes = await startAlbumPerf({ drawing: false });
const partFrames = await startAlbumPerf();
const partReconciles = await startAlbumPerf();

// With a renderer that draws (the gate of spec 33 G on), a peek's commit parks the page it mounts behind the clip and
// the turn after it finishes that build before its diff: "a swipe step" and "peek: reconcile only" measure that pair
// now; "a swipe step, gate off" keeps the whole mount of a headless app for comparison.
describe(`ui: the album swipe, a root of ${turns.elements} elements (F244)`, () => {
  bench("a turn: the two pages swap, reconcile + solve + enter", turns.turn, BENCH_OPTIONS);
  bench("a swipe step: a peek mounts a page and drops one, or a turn", swipes.swipe, BENCH_OPTIONS);
  bench("turn: reconcile only", turnWalks.turnReconcile, BENCH_OPTIONS);
  bench("peek: reconcile only", peekWalks.peekReconcile, BENCH_OPTIONS);
  bench("a swipe step, gate off: a peek mounts its page whole", wholeSwipes.swipe, BENCH_OPTIONS);
  bench(
    "one part frame: 48 elements behind the clip, whole frame",
    partFrames.partFrame,
    BENCH_OPTIONS
  );
  bench("a part frame: its reconcile alone", partReconciles.partReconcile, BENCH_OPTIONS);
  bench(
    "a render of the album's tree: the JSX factory builds its nodes",
    () => {
      albumTree(3, 4, 1);
    },
    BENCH_OPTIONS
  );
});
