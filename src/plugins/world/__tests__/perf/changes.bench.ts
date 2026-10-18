import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import { changedIdleFixture, marksFixture } from "./fixtures";

describe("change sets", () => {
  bench("100 marks + clear", marksFixture(), BENCH_OPTIONS);
  bench("changed(), nothing marked, walked", changedIdleFixture(), BENCH_OPTIONS);
});
