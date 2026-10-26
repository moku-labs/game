import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import { createMockRenderer } from "../mock-renderer";

const mock = createMockRenderer();

await mock.start();

describe("the step of the picture of a scene being left", () => {
  bench(
    "one step with no switch running",
    () => {
      mock.modules.sync.stepLeave();
    },
    BENCH_OPTIONS
  );
});
