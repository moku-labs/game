import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import { idleMissedMarks, markedFrame } from "./fixtures";

const always = await markedFrame(20, false);
const onDemand = await markedFrame(20, true);

describe("the marks of a frame", () => {
  bench("20 marks and the decision", always, BENCH_OPTIONS);
  bench("20 marks and the decision, onDemand", onDemand, BENCH_OPTIONS);
});

const idle = idleMissedMarks(300);

describe("the dev missed-mark check (F69)", () => {
  bench("a skipped frame, 300 views, 5 stale listed writes", idle, BENCH_OPTIONS);
});
