import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import { startArcs } from "./fixtures";

const still = await startArcs();
const moving = await startArcs();
const { ring } = moving;

describe("a slot timer's ring among twelve", () => {
  bench(
    "a pass that syncs the ring, nothing of it changed",
    () => still.mock.modules.sync.pass(),
    BENCH_OPTIONS
  );

  bench(
    "a pass whose ring sweeps on: its arc built again",
    () => {
      ring.sweep = ring.sweep === 0.42 ? 0.43 : 0.42;
      moving.mock.modules.sync.pass();
    },
    BENCH_OPTIONS
  );
});
