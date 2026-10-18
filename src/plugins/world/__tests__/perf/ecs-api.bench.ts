import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import { ecsCallsFixture } from "./fixtures";

const calls = ecsCallsFixture();

describe("ecs calls a game makes every frame", () => {
  bench("ecs.get", calls.get, BENCH_OPTIONS);
  bench("ecs.set, one double field", calls.set, BENCH_OPTIONS);
  bench("ecs.set, three double fields", calls.setThree, BENCH_OPTIONS);
  bench("ecs.set, one integer field", calls.setInteger, BENCH_OPTIONS);
  bench("ecs.has", calls.has, BENCH_OPTIONS);
  bench("ecs.resource(Now)", calls.res, BENCH_OPTIONS);
});
