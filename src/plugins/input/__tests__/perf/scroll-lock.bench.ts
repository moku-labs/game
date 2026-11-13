import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import { downOnMovingLocked, dropLocked, handOffLocked } from "./fixtures";

// ---------------------------------------------------------------------------
// Bench: the scroll lock (F177) on the pointer path, time per call.
// ---------------------------------------------------------------------------

describe("the scroll lock", () => {
  bench("refused hand-off, a card in a locked strip", handOffLocked().call, BENCH_OPTIONS);
  bench("catch passes over a moving locked strip", downOnMovingLocked(), BENCH_OPTIONS);
  bench("drop of a press held on a locked strip", dropLocked().call, BENCH_OPTIONS);
});
