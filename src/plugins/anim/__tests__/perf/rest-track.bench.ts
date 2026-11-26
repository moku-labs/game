import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import { restMoveFixture } from "./fixtures";

const plain = restMoveFixture(false);
const handled = restMoveFixture(true);

describe("anim: a rest move of 0 ms, start to end (F244 В)", () => {
  bench("through startTrack: a kept record, landed and dropped", plain, BENCH_OPTIONS);
  bench("through the driver: the same, and its handle", handled, BENCH_OPTIONS);
});
