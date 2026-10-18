import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import { lateAtFloorTick, realNow, steadyTick } from "./fixtures";

/** The fixtures answer `performance.now()` from their own page clock: the bench times its runs with the real one. */
const OPTIONS = { ...BENCH_OPTIONS, now: realNow };

describe("a tick of the adaptive frame rate", () => {
  bench("a steady screen at the top", steadyTick(), OPTIONS);
  bench("a GPU-bound screen at the floor", lateAtFloorTick(), OPTIONS);
});
