import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import { edgeFrame, monitorFrame, startEdgeAgent, startPlainAgent, steadyFrame } from "./fixtures";

const agent = await startPlainAgent("real");
const timed = await startEdgeAgent("real");
const steady = steadyFrame();
const late = steadyFrame(30);
const quiet = steadyFrame();
const edged = steadyFrame();

describe("the monitor's frame", () => {
  bench("a steady frame, no listener", () => monitorFrame(agent, steady), BENCH_OPTIONS);
  bench("a late frame, no listener", () => monitorFrame(agent, late), BENCH_OPTIONS);
  bench(
    "a steady frame, the flow times edges, none came",
    () => monitorFrame(timed, quiet),
    BENCH_OPTIONS
  );
  bench("a steady frame, two flow edges before it", () => edgeFrame(timed, edged), BENCH_OPTIONS);
});
