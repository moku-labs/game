import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import { startGuidePerf } from "./guide.fixture";

const perf = await startGuidePerf();

describe("ui guide pass", () => {
  bench("a veil of four on a still view", perf.still, BENCH_OPTIONS);
  bench("a veil of four on a moving view", perf.moving, BENCH_OPTIONS);
});
