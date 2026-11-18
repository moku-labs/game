import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import { readyStep } from "./fixtures";

const resting = readyStep(false);
const waiting = readyStep(true);

describe("assets: the system assets.ready", () => {
  bench("no ready waits", resting, BENCH_OPTIONS);
  bench("a ready waits for a warm build under its cap", waiting, BENCH_OPTIONS);
});
