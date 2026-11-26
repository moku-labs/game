import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import { standingReposeCall, standingVisualCall } from "./kept-pose.fixture";

const shape = standingVisualCall("shape");
const text = standingVisualCall("text");
const pose = standingReposeCall();

describe("ui: the kept values of an element that stands (F244 В)", () => {
  bench("visualOf of a standing shape", shape, BENCH_OPTIONS);
  bench("visualOf of a standing text", text, BENCH_OPTIONS);
  bench("repose of a standing element", pose, BENCH_OPTIONS);
});
