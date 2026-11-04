import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import { fadedPartBoard, filteredStage, hudStage, hudUnderBoard } from "./fixtures";

const filtered = await filteredStage();
const hud = await hudStage();
const under = await hudUnderBoard();
const faded = await fadedPartBoard();

describe("a still frame", () => {
  bench(
    "the render passes of 12 filtered views",
    () => {
      filtered.api.sync.renderPasses();
    },
    BENCH_OPTIONS
  );
  bench("the overlay step with 5 HUD parts", () => hud.modules.sync.stepOverlays(), BENCH_OPTIONS);
  bench("the overlay step of a resting sheet with the HUD under its dim", under, BENCH_OPTIONS);
  bench("the overlay step of a resting shop that fades a HUD part", faded, BENCH_OPTIONS);
});
