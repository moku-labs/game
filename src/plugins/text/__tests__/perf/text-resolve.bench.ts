import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import { resolveFixture } from "./fixtures";

describe("text resolve", () => {
  bench("frame, 100 labels, 20 bound, idle", resolveFixture("nothing"), BENCH_OPTIONS);
  bench("frame, 100 labels, one bound value moving", resolveFixture("value"), BENCH_OPTIONS);
  bench("frame, 100 labels, one countdown running", resolveFixture("countdown"), BENCH_OPTIONS);
  bench(
    "step after the layout flush, nothing added",
    resolveFixture("nothing", "added"),
    BENCH_OPTIONS
  );
  bench(
    "frame, 100 labels, 20 written once more",
    resolveFixture("nothing", "rewrite"),
    BENCH_OPTIONS
  );
});
