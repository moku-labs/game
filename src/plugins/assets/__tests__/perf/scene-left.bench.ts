import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import { exitEndNothingLeaves, exitEndStillExiting } from "./fixtures";

const nothingLeaves = exitEndNothingLeaves();
const stillExiting = exitEndStillExiting();

describe("assets: the end of an exit", () => {
  bench("no scene leaves", nothingLeaves, BENCH_OPTIONS);
  bench("a scene leaves, another element still exits", stillExiting, BENCH_OPTIONS);
});
