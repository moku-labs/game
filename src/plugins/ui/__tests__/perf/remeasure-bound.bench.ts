import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import { remeasureCall } from "./remeasure-bound.fixture";

const call = remeasureCall();

describe("ui remeasure of a bound text", () => {
  bench("remeasureShown, built-in bind, size stands", call, BENCH_OPTIONS);
});
