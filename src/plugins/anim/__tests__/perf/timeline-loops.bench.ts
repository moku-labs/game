import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import { bouncesFixture, heldBouncesFixture, restingBouncesFixture } from "./fixtures";

describe("anim endless timeline tracks", () => {
  bench("frame step, 10 endless bounces moving", bouncesFixture(), BENCH_OPTIONS);
  bench("frame step, 10 endless bounces in their pause", restingBouncesFixture(), BENCH_OPTIONS);
  bench("frame step, 10 endless bounces of views nobody sees", heldBouncesFixture(), BENCH_OPTIONS);
});
