import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import { startAnchorPerf } from "./anchor.fixture";

const perf = await startAnchorPerf();

describe("ui anchor pass", () => {
  bench("two anchors, targets still", perf.still, BENCH_OPTIONS);
  bench("two anchors, one following a moving view", perf.moving, BENCH_OPTIONS);
});
