import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import { restLookAhead } from "./fixtures";

const walk = await restLookAhead();

describe("the look-ahead of a rest (F194)", () => {
  bench("one walk, a hub with six windows, the same committed state", walk, BENCH_OPTIONS);
});
