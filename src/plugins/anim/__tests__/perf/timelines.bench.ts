import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import {
  crowdedTimelinesFixture,
  timelineEdgesFixture,
  timelinesFixture,
  waitingTimelinesFixture
} from "./fixtures";

describe("anim timelines", () => {
  bench("frame step, 10 timelines waiting", waitingTimelinesFixture(), BENCH_OPTIONS);
  bench("frame step, 10 timelines running", timelinesFixture(), BENCH_OPTIONS);
  bench("frame step, 50 timelines running", crowdedTimelinesFixture(), BENCH_OPTIONS);
  bench("start + end 1000 timelines with a hook listener", timelineEdgesFixture(), BENCH_OPTIONS);
});
