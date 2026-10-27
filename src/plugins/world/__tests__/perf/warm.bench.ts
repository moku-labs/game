import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import { warmCallsFixture, warmOpenFixture } from "./fixtures";

const resting = warmCallsFixture(false);
const building = warmCallsFixture(true);
const open = warmOpenFixture();

describe("warm windows", () => {
  bench("stepWarm(), at rest", resting.step, BENCH_OPTIONS);
  bench("input step, at rest with a warm window held", resting.input, BENCH_OPTIONS);
  bench("stepWarm(), polling two checks", building.step, BENCH_OPTIONS);
  bench("projection.left(), a held view building", building.left, BENCH_OPTIONS);
  bench("open, close and rebuild of a warm sheet of 20 rows", open, BENCH_OPTIONS);
});
