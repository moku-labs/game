import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import { startPerfUi, startWarmPerf } from "./fixtures";

const idle = await startPerfUi();
const warm = await startWarmPerf();

describe("ui with windows held warm, at rest", () => {
  bench(
    "reconcile + solve, ten roots",
    () => {
      idle.reconcile();
      idle.solve();
    },
    BENCH_OPTIONS
  );

  bench(
    "reconcile + solve, ten roots and two held warm",
    () => {
      warm.reconcile();
      warm.solve();
    },
    BENCH_OPTIONS
  );

  bench("ui.enter, two windows held warm", warm.enter, BENCH_OPTIONS);
});
