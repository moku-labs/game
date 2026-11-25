import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import { startAlbumPerf } from "./album.fixture";

const turns = await startAlbumPerf();
const swipes = await startAlbumPerf();

describe(`ui: the album swipe, a root of ${turns.elements} elements (F244)`, () => {
  bench("a turn: the two pages swap, reconcile + solve + enter", turns.turn, BENCH_OPTIONS);
  bench("a swipe step: a peek mounts a page and drops one, or a turn", swipes.swipe, BENCH_OPTIONS);
});
