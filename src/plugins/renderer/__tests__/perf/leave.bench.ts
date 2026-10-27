import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import { createMockRenderer } from "../mock-renderer";
import { fadingLoader } from "./fixtures";

const mock = createMockRenderer();

await mock.start();
// One look shown, drawn and dropped, as in `leave.perf.ts`: its objects are kept, the step reads two fields.
mock.api.sync.leave.show({
  cover: { color: 0, alpha: 0.45, inMs: 150, outMs: 150 },
  loader: { afterMs: 0 }
});
mock.runPhase("render");
mock.api.sync.leave.drop();

// After a swap, as in `leave.perf.ts`: a loader layer fading out with the veil, and one waiting for its views to leave.
const fading = await fadingLoader("fade");
const waiting = await fadingLoader("wait");

describe("the step of the picture of a scene being left", () => {
  bench(
    "one step with no switch running",
    () => {
      mock.modules.sync.stepLeave();
    },
    BENCH_OPTIONS
  );

  bench(
    "one step of the fade-out, a loader layer fading with the veil",
    fading.step,
    BENCH_OPTIONS
  );

  bench(
    "one step of the wait, a loader layer waiting for its views to leave",
    waiting.step,
    BENCH_OPTIONS
  );
});
