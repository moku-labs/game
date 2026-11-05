import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import {
  currentLabelFixture,
  gameDrawFixture,
  gameLayoutFixture,
  layoutFixture,
  namedFixture,
  resolveFixture,
  runsFixture
} from "./fixtures";

describe("text resolve", () => {
  bench("frame, 100 labels, 20 bound, idle", resolveFixture("nothing"), BENCH_OPTIONS);
  bench("frame, 100 labels, one bound value moving", resolveFixture("value"), BENCH_OPTIONS);
  bench("frame, 100 labels, one countdown running", resolveFixture("countdown"), BENCH_OPTIONS);
  bench(
    "step after the layout flush, nothing added",
    resolveFixture("nothing", "added"),
    BENCH_OPTIONS
  );
  bench(
    "frame, 100 labels, 20 written once more",
    resolveFixture("nothing", "rewrite"),
    BENCH_OPTIONS
  );
  bench(
    "frame, 100 labels, 80 wrapped at their box, idle",
    resolveFixture("nothing", "phase", "box"),
    BENCH_OPTIONS
  );
  bench(
    "frame, 100 labels, 80 balanced at their box, idle",
    resolveFixture("nothing", "phase", "balanced"),
    BENCH_OPTIONS
  );
  bench("layout of a two-line block, greedy", layoutFixture(false), BENCH_OPTIONS);
  bench("layout of a two-line block, balanced", layoutFixture(true), BENCH_OPTIONS);
  bench("adapter update, box label written again as it is", currentLabelFixture(), BENCH_OPTIONS);
  bench("frame, 100 labels, 20 named, idle", namedFixture("nothing"), BENCH_OPTIONS);
  bench("frame, 100 labels, one named step, same answer", namedFixture("same"), BENCH_OPTIONS);
  bench("frame, 100 labels, one named step, new text", namedFixture("text"), BENCH_OPTIONS);
  bench("frame, 50 labels with <span> and boldStyle runs, idle", runsFixture(), BENCH_OPTIONS);
  bench("layout of the game line, with runs", gameLayoutFixture(true), BENCH_OPTIONS);
  bench("layout of the game line, plain", gameLayoutFixture(false), BENCH_OPTIONS);
  bench("draw of the game line, with runs", gameDrawFixture(true), BENCH_OPTIONS);
  bench("draw of the game line, plain", gameDrawFixture(false), BENCH_OPTIONS);
});
