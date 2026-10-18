import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import { sweepFixture } from "./fixtures";

describe("projection sweep", () => {
  bench("sweep, 300 resting views", sweepFixture(0), BENCH_OPTIONS);
  bench("sweep, 300 resting views, 10 tracks ending", sweepFixture(10), BENCH_OPTIONS);
});
