import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import { filtersFixture, tweenStep } from "./fixtures";

describe("effects:filters", () => {
  bench("frame step, 12 filtered views, nothing changed", filtersFixture().run, BENCH_OPTIONS);
  bench("frame step, one Glow tweened of 12", tweenStep(filtersFixture()), BENCH_OPTIONS);
});
