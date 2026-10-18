import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import { backdropFixture, backdropStep } from "./fixtures";

describe("effects:backdrop", () => {
  bench("apply, a backdrop without inputs", backdropFixture().applyUnder, BENCH_OPTIONS);
  bench("apply, a backdrop with a chain from back", backdropFixture().applyFrosted, BENCH_OPTIONS);
  bench(
    "frame step, the spread of a backdrop tweened",
    backdropStep(backdropFixture()),
    BENCH_OPTIONS
  );
});
