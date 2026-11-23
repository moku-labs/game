import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import { preloadStep } from "./fixtures";

const resting = preloadStep(false);
const waiting = preloadStep(true);

describe("assets: the system assets.preload", () => {
  bench("no rest waits for its walk", resting, BENCH_OPTIONS);
  bench("a rest waits while the world plays, under its cap", waiting, BENCH_OPTIONS);
});
