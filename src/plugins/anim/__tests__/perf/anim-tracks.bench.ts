import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import { heldLoopsFixture, partialTracksFixture, tracksFixture } from "./fixtures";

describe("anim tracks", () => {
  bench("frame step, 50 loops held", heldLoopsFixture(), BENCH_OPTIONS);
  bench("frame step, 50 tracks running", tracksFixture(), BENCH_OPTIONS);
  bench("frame step, 50 tracks moving some fields", partialTracksFixture(), BENCH_OPTIONS);
});
