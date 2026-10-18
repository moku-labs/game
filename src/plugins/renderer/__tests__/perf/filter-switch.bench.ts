import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import { alphaSwitchBoard, filteredStage } from "./fixtures";

const off = await filteredStage(false);
const on = await filteredStage();
const switching = await alphaSwitchBoard(10);

describe("the filter switch step", () => {
  bench("12 views, filters off", () => off.modules.sync.stepFilters(), BENCH_OPTIONS);
  bench("12 views, filters on", () => on.modules.sync.stepFilters(), BENCH_OPTIONS);
  bench("an alpha switched every frame, 10 kept views", switching, BENCH_OPTIONS);
});
