import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import { FULL_STYLE, NARROW_STYLE, startStyleFixture, WIDER_STYLE } from "./apply-style.fixture";

const unchanged = await startStyleFixture();
const changed = await startStyleFixture();
/** Which of the pair the next changed write takes. */
const turn = new Uint8Array(1);

describe("Yoga style write", () => {
  bench("unchanged write, every group set", () => unchanged.write(FULL_STYLE), BENCH_OPTIONS);
  bench(
    "write with one field changed (width 120 and 121 in turn)",
    () => {
      turn[0] = turn[0] === 0 ? 1 : 0;
      changed.write(turn[0] === 0 ? NARROW_STYLE : WIDER_STYLE);
    },
    BENCH_OPTIONS
  );
});
