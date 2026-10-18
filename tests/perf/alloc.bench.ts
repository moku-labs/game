import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "./alloc";

const items = Array.from({ length: 30 }, (_, index) => index);
/** Holds the last copy, so the spread is kept and never optimized away. */
const sink = { kept: items };

describe("alloc fixtures", () => {
  bench("an empty function", () => {}, BENCH_OPTIONS);

  bench(
    "a spread of 30 numbers",
    () => {
      sink.kept = [...items];
    },
    BENCH_OPTIONS
  );
});
