import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import { startShots } from "../shots-gpu";

const { mock } = await startShots();

// One shot taken, as in `shots.perf.ts`: what a game holds between its switches.
mock.api.shots.take("shot.room");
mock.runPhase("render");
mock.runPhase("render");

describe("shots.after", () => {
  bench(
    "one frame with nothing wanted",
    () => {
      mock.modules.shots.after(true);
    },
    BENCH_OPTIONS
  );
});
