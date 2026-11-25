import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import { startTrackFixture } from "./fixtures";

describe("anim startTrack", () => {
  bench(
    "start a 2-field track over an older owner, end the older",
    startTrackFixture(),
    BENCH_OPTIONS
  );
});
