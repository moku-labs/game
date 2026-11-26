import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import { setRestFixture } from "./fixtures";

const setRest = setRestFixture();

describe("world: setRest of a moved plain pose (F244 В)", () => {
  bench("the kept rest record written in place", setRest, BENCH_OPTIONS);
});
