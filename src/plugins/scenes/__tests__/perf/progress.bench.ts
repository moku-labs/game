import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import { progressBelowStep } from "./fixtures";

const belowStep = await progressBelowStep();

describe("scenes: the progress hook of a switch", () => {
  bench("one file settled, below the step", belowStep, BENCH_OPTIONS);
});
