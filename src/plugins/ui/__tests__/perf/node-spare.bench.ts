import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import { startSpareFixture } from "./node-spare.fixture";

const spare = await startSpareFixture();

describe("ui: the Yoga node of an element that enters and leaves (hp-2ab)", () => {
  bench("node taken from the spare and put back", spare.reused, BENCH_OPTIONS);
  bench(
    "node taken back after a width and a min height, unset on the take-back",
    spare.reusedSized,
    BENCH_OPTIONS
  );
  bench("node made new and freed, as before the spare", spare.fresh, BENCH_OPTIONS);
});
