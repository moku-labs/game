import { afterAll, bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import { trailFrame, trailRest } from "../../trail";
import { trailStage } from "./trail-fixtures";

const bare = await trailStage(false);
const kept = await trailStage(true);
const trail = kept.mock.ctx.state.trail;
const paths = ["board/awaitIntent", "ward/idle"] as const;
let turn = 0;

afterAll(() => {
  bare.mock.stop();
  kept.mock.stop();
});

describe("the trail of the run (F175)", () => {
  bench("a drawn frame of 20 sprites, no trail", () => bare.mock.drawFrame(), BENCH_OPTIONS);
  bench(
    "a drawn frame of 20 sprites, the trail started",
    () => kept.mock.drawFrame(),
    BENCH_OPTIONS
  );
  bench("the count of a drawn frame", () => trailFrame(trail, false), BENCH_OPTIONS);
  bench(
    "one write: a new rest path (the record, JSON, setItem)",
    () => {
      turn = 1 - turn;
      trailRest(trail, paths[turn] ?? "board");
    },
    BENCH_OPTIONS
  );
});
