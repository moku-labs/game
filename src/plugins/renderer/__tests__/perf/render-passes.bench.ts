import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import { filteredStage, hudStage } from "./fixtures";

const filtered = await filteredStage();
const hud = await hudStage();

describe("a still frame", () => {
  bench(
    "the render passes of 12 filtered views",
    () => {
      filtered.api.sync.renderPasses();
    },
    BENCH_OPTIONS
  );
  bench("the overlay step with 5 HUD parts", () => hud.modules.sync.stepOverlays(), BENCH_OPTIONS);
});
