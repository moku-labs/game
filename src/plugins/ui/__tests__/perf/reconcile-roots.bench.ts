import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import { startPerfUi } from "./fixtures";

const ui = await startPerfUi();

describe("ui reconcile and solve", () => {
  bench(
    "idle frame, 10 roots",
    () => {
      ui.reconcile();
      ui.solve();
    },
    BENCH_OPTIONS
  );
});
