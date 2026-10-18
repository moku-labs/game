import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import { scopeCheckFixture, scopedFixture } from "./fixtures";

describe("scoped systems", () => {
  bench(
    "frame, 40 board systems that always run (before spec 28)",
    scopedFixture("always").frame,
    BENCH_OPTIONS
  );
  bench(
    "frame, 40 board systems asleep (systemsRun: active, board not active)",
    scopedFixture("active").frame,
    BENCH_OPTIONS
  );
  bench(
    "frame, 20 features evaluated after a move of the flow",
    scopeCheckFixture(),
    BENCH_OPTIONS
  );
});
