import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import { describeCall } from "./fixtures";

const before = describeCall(false);
const after = describeCall(true);

describe("describe() of a game-sized graph, 40 windows of 12 nodes (F196)", () => {
  bench("before run(): rendered on every call", before, BENCH_OPTIONS);
  bench("after run(): rendered once", after, BENCH_OPTIONS);
});
