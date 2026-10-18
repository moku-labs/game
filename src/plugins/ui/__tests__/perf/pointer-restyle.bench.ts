import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import { keyed, pressRelease, startPerfUi } from "./fixtures";

const ui = await startPerfUi();

describe("pointer restyle", () => {
  bench("press + release, 200-element root", pressRelease(ui, keyed(ui, "hot")), BENCH_OPTIONS);
});
