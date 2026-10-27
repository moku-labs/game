import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import { startAnchorPerf, startLoopPerf } from "./anchor.fixture";

const perf = await startAnchorPerf();
const swaying = await startLoopPerf();

describe("ui anchor pass", () => {
  bench("two anchors, targets still", perf.still, BENCH_OPTIONS);
  bench("two anchors, one following a moving view", perf.moving, BENCH_OPTIONS);
  bench("a root anchor under a loop, following a moving view", swaying.moving, BENCH_OPTIONS);
});
