import { bench, describe, vi } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import { monitorFrame, startPlainAgent, steadyFrame } from "./fixtures";

vi.stubGlobal("__MOKU_GAME_CONTROL__", true);

const on = await startPlainAgent("real");
const off = await startPlainAgent("real");
const onFrame = steadyFrame();
const offFrame = steadyFrame();

off.mock.api.monitor.sections({
  gpu: false,
  passes: false,
  counts: false,
  systems: false,
  longFrames: false,
  heap: false
});

describe("the monitor's frame by its sections", () => {
  bench("every section on", () => monitorFrame(on, onFrame), BENCH_OPTIONS);
  bench("every section off", () => monitorFrame(off, offFrame), BENCH_OPTIONS);
});
