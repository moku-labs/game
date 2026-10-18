import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import { phasesFixture } from "./fixtures";

describe("run phase", () => {
  bench("frame, 4 phases x 40 empty-query systems", phasesFixture(), BENCH_OPTIONS);
});
