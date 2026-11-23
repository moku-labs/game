import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import {
  entryFixture,
  warmCallsFixture,
  warmNextFixture,
  warmOpenFixture,
  warmPruneFixture,
  warmSwapFixture,
  warmWaitingFixture
} from "./fixtures";

const resting = warmCallsFixture(false);
const building = warmCallsFixture(true);
const open = warmOpenFixture();
const prune = warmPruneFixture();
const next = warmNextFixture();
const waiting = warmWaitingFixture();
const entry = entryFixture();
const swap = warmSwapFixture();

describe("warm windows", () => {
  bench("stepWarm(), at rest", resting.step, BENCH_OPTIONS);
  bench("input step, at rest with a warm window held", resting.input, BENCH_OPTIONS);
  bench("stepWarm(), polling two checks", building.step, BENCH_OPTIONS);
  bench("projection.left(), a held view building", building.left, BENCH_OPTIONS);
  bench("open, close and rebuild of a warm sheet of 20 rows", open, BENCH_OPTIONS);
  bench("sweep after a despawn, a warm sheet of 600 elements held", prune, BENCH_OPTIONS);
});

describe("the open view of a gated window built under its dim (F202)", () => {
  bench("stepWarm(), the next view polling under an owned motion", next, BENCH_OPTIONS);
  bench("stepWarm(), a sheet waiting under an owned motion", waiting, BENCH_OPTIONS);
  bench("applyEntry, a live key with the same item, nothing warm", entry.same, BENCH_OPTIONS);
  bench(
    "applyEntry, a live key handed a new object with the same content (F230)",
    entry.equal,
    BENCH_OPTIONS
  );
  bench(
    "the swap check of a live key with a new item, nothing warm",
    entry.swapCheck,
    BENCH_OPTIONS
  );
  bench("dim, build aside, swap and close of a gated window of 20 rows", swap, BENCH_OPTIONS);
});
