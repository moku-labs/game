import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import { timelinesFixture, waitingTimelinesFixture } from "./fixtures";

describe("anim timelines", () => {
  bench("frame step, 10 timelines waiting", waitingTimelinesFixture(), BENCH_OPTIONS);
  bench("frame step, 10 timelines running", timelinesFixture(), BENCH_OPTIONS);
});
