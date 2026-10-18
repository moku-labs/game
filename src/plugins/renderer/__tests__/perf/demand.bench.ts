import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import { markedFrame } from "./fixtures";

const always = await markedFrame(20, false);
const onDemand = await markedFrame(20, true);

describe("the marks of a frame", () => {
  bench("20 marks and the decision", always, BENCH_OPTIONS);
  bench("20 marks and the decision, onDemand", onDemand, BENCH_OPTIONS);
});
