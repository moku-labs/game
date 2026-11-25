import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import { bornRestFixture, heldLoopsFixture, partialTracksFixture, tracksFixture } from "./fixtures";

describe("anim tracks", () => {
  bench("frame step, 50 loops held", heldLoopsFixture(), BENCH_OPTIONS);
  bench("frame step, 50 tracks running", tracksFixture(), BENCH_OPTIONS);
  bench("frame step, 50 tracks moving some fields", partialTracksFixture(), BENCH_OPTIONS);
  bench("pass before the draw, 50 tracks running, none born", bornRestFixture(), BENCH_OPTIONS);
});
