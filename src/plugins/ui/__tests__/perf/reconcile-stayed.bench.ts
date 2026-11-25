import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import { startStayedPerf } from "./reconcile-stayed.fixture";

const stayed = await startStayedPerf();
const changed = await startStayedPerf();

describe("ui reconcile of the stayed root, 108 elements", () => {
  bench("equal tree: every element stayed", stayed.stayed, BENCH_OPTIONS);
  bench("three titles changed, in turn with the first tree", changed.changed, BENCH_OPTIONS);
});
