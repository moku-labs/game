import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import { CROSSING, fadeStep, filtersFixture, HALF, RESTING, tweenStep } from "./fixtures";

describe("effects:filters", () => {
  bench("frame step, 12 filtered views, nothing changed", filtersFixture().run, BENCH_OPTIONS);
  bench("frame step, one Glow tweened of 12", tweenStep(filtersFixture()), BENCH_OPTIONS);
  bench(
    "frame step, one Alpha touching 1 of 12",
    fadeStep(filtersFixture(), CROSSING),
    BENCH_OPTIONS
  );
  bench(
    "frame step, one Alpha resting at 1 of 12",
    fadeStep(filtersFixture(), RESTING),
    BENCH_OPTIONS
  );
  bench(
    "frame step, one Alpha at 0.5 fading of 12",
    fadeStep(filtersFixture(), HALF),
    BENCH_OPTIONS
  );
});
