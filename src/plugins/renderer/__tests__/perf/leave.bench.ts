import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import { createMockRenderer } from "../mock-renderer";

const mock = createMockRenderer();

await mock.start();
// One look shown, drawn and dropped, as in `leave.perf.ts`: its objects are kept, the step reads one field.
mock.api.sync.leave.show({
  cover: { color: 0, alpha: 0.45, inMs: 150, outMs: 150 },
  loader: { afterMs: 0 }
});
mock.runPhase("render");
mock.api.sync.leave.drop();

describe("the step of the picture of a scene being left", () => {
  bench(
    "one step with no switch running",
    () => {
      mock.modules.sync.stepLeave();
    },
    BENCH_OPTIONS
  );
});
