import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import { lookCall } from "./look-moved.fixture";

const call = lookCall();

describe("ui look check", () => {
  bench("lookMoved, Shape, Sprite, NineSlice and Text, none moved", call, BENCH_OPTIONS);
});
