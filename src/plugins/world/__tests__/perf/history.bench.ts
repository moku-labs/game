import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import { recordedFrameFixture } from "./fixtures";

const recorded = recordedFrameFixture();
const busy = recordedFrameFixture(400, 200);

describe("the frame history of a dev build (F70)", () => {
  bench("one recorded frame, 20 of 100 Spots moved", recorded, BENCH_OPTIONS);
  bench("one recorded frame, 200 of 400 Spots moved, over the spare floor", busy, BENCH_OPTIONS);
});
