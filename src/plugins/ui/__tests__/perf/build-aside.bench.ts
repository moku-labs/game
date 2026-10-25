import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import { startAsidePerf, startPerfUi } from "./fixtures";

const idle = await startPerfUi();
const building = await startAsidePerf();

describe("ui and a scene built aside", () => {
  bench(
    "ui's part of a build, 10 roots, none aside",
    () => {
      idle.built();
    },
    BENCH_OPTIONS
  );

  bench(
    "ui's part of a build, one root aside and solved",
    () => {
      building.built();
    },
    BENCH_OPTIONS
  );

  bench("ui.enter, the names' elements held", building.enter, BENCH_OPTIONS);

  bench(
    "reconcile + solve, one root aside",
    () => {
      building.reconcile();
      building.solve();
    },
    BENCH_OPTIONS
  );
});
