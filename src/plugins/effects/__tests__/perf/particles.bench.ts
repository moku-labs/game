import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import { particlesFixture } from "./fixtures";

describe("effects:particles", () => {
  bench(
    "frame step, 3 emitters following a still host",
    particlesFixture(false).run,
    BENCH_OPTIONS
  );
  bench("frame step, 3 streams emitting", particlesFixture(true).run, BENCH_OPTIONS);
});
