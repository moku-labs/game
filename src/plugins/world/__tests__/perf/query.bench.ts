import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import { nestedQueryFixture, queryFixture } from "./fixtures";

describe("ecs.query outside a phase", () => {
  bench("query(Cell, Lit), 300 entities, 30 matching", queryFixture(), BENCH_OPTIONS);
  bench("nested: 5 outer rows, query(Cell, Lit) in each", nestedQueryFixture(), BENCH_OPTIONS);
});
