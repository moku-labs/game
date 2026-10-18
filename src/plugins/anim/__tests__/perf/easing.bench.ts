import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import { bezierFixture } from "./fixtures";

describe("anim easing", () => {
  bench("cubicBezier, design out curve", bezierFixture([0.22, 0.61, 0.36, 1]), BENCH_OPTIONS);
  bench("cubicBezier, vertical start", bezierFixture([0, 0.55, 0.45, 1]), BENCH_OPTIONS);
});
