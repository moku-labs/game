import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import { startTextWhenPerf } from "./fixtures";
import { textWhenRemeasureCall } from "./text-when.fixture";

const ui = await startTextWhenPerf();
const remeasure = textWhenRemeasureCall();

describe("ui texts whose key follows the frame (F182)", () => {
  bench(
    "reconcile + solve, idle, ten when-keyed texts",
    () => {
      ui.reconcile();
      ui.solve();
    },
    BENCH_OPTIONS
  );
  bench("remeasureShown, when-keyed text, size stands", remeasure, BENCH_OPTIONS);
});
