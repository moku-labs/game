import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import { walkFixture } from "./fixtures";

describe("world walk", () => {
  bench("frame, 40 systems over 300 entities, 30 matching", walkFixture(30), BENCH_OPTIONS);
  bench("frame, 40 systems over 300 entities, 300 matching", walkFixture(300), BENCH_OPTIONS);
});
