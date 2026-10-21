import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import { startBoxPerf, startPerfUi } from "./fixtures";

const ui = await startPerfUi();
const boxed = await startBoxPerf();

describe("ui reconcile and solve", () => {
  bench(
    "idle frame, 10 roots",
    () => {
      ui.reconcile();
      ui.solve();
    },
    BENCH_OPTIONS
  );
  bench(
    "idle frame, 10 roots and 8 names wrapped at their box",
    () => {
      boxed.reconcile();
      boxed.solve();
    },
    BENCH_OPTIONS
  );
});
