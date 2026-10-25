import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import { lookWriteCall } from "./look-write.fixture";

const call = lookWriteCall();

describe("ui look write", () => {
  bench("writeLook, an arc's sweep moved, the hook plays", call, BENCH_OPTIONS);
});
