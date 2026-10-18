import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import { monitorFrame, startPlainAgent, steadyFrame } from "./fixtures";

const agent = await startPlainAgent("real");
const steady = steadyFrame();
const late = steadyFrame(30);

describe("the monitor's frame", () => {
  bench("a steady frame, no listener", () => monitorFrame(agent, steady), BENCH_OPTIONS);
  bench("a late frame, no listener", () => monitorFrame(agent, late), BENCH_OPTIONS);
});
