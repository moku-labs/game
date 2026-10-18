import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import { emptyQueryFixture, sceneSkipFixture, skipCheckFixture } from "./fixtures";

describe("skipped systems", () => {
  bench(
    "frame, 40 systems whose query has no entity (300 Cell, Ghost emptied)",
    emptyQueryFixture().frame,
    BENCH_OPTIONS
  );
  bench(
    "frame, 40 systems of a scene that is not mounted",
    sceneSkipFixture().frame,
    BENCH_OPTIONS
  );
  bench(
    "frame, 40 systems that pass the check (two stores, a mounted and a leaving scene)",
    skipCheckFixture().frame,
    BENCH_OPTIONS
  );
  bench(
    "frame, 40 systems that pass the check (two stores, no scenes)",
    skipCheckFixture(false).frame,
    BENCH_OPTIONS
  );
});
