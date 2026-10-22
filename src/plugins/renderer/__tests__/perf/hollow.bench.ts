import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import { startHollows } from "./fixtures";

const still = await startHollows();
const resized = await startHollows();

describe("a hollow nine-slice", () => {
  bench(
    "one pass that syncs a hollow frame whose value stood",
    () => still.mock.modules.sync.pass(),
    BENCH_OPTIONS
  );

  bench(
    "one pass that resizes a hollow frame",
    () => {
      resized.panel.width = resized.panel.width === 300 ? 301 : 300;
      resized.mock.modules.sync.pass();
    },
    BENCH_OPTIONS
  );
});
