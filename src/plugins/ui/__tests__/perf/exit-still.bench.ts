import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import { stillCall } from "./exit-still.fixture";

const call = stillCall();

describe("ui exit sweep", () => {
  bench("still, three motions, one endless", call, BENCH_OPTIONS);
});
