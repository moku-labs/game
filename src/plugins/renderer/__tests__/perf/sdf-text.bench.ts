import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import { sdfTextStage } from "../sdf-text-stage";

const stage = sdfTextStage();
let digit = 0;

describe("an SDF text update", () => {
  bench(
    "one layout of a two-digit label",
    () => {
      digit = (digit + 1) % 10;
      stage.update(digit === 0 ? "10" : String(digit));
    },
    BENCH_OPTIONS
  );
});
