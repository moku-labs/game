import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import { createMockRenderer } from "../mock-renderer";

const mock = createMockRenderer();

await mock.start();

describe("the upload step", () => {
  bench(
    "one step with an empty queue",
    () => {
      mock.modules.sync.uploadStep();
    },
    BENCH_OPTIONS
  );
});
