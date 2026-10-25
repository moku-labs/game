import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import { buildWaiting } from "./fixtures";

const waiting = await buildWaiting();

describe("scenes: the frame callback of a scene build", () => {
  bench("the build is not done", waiting, BENCH_OPTIONS);
});
