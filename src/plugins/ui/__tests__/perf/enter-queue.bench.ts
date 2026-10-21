import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import { startPerfUi } from "./fixtures";

const ui = await startPerfUi();
const row = ui.app.ui.find("r0") ?? 0;

describe("ui enter queue", () => {
  bench(
    "Box queued + ui.enter, one element",
    () => {
      ui.boxed(row);
      ui.enter();
    },
    BENCH_OPTIONS
  );
});
