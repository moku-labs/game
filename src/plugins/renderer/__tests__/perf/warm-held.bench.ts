import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import { stepAside } from "../../sync/build";
import { restingWarm } from "./fixtures";

const resting = await restingWarm(2, 300);

/**
 * Logs nothing: no view is made at rest.
 */
function silent(): void {
  // Nothing throws at rest.
}

describe("the frame functions while warm windows rest held", () => {
  bench(
    "a still pass while two windows of 300 elements rest held",
    () => resting.mock.modules.sync.pass(),
    BENCH_OPTIONS
  );

  bench(
    "the build step while the windows rest",
    () => {
      stepAside(resting.sctx, silent);
    },
    BENCH_OPTIONS
  );
});
