import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import { buildCallsFixture } from "./fixtures";

const idle = buildCallsFixture(false);
const building = buildCallsFixture(true);

describe("scene build frame calls", () => {
  bench("projection.left(), idle", idle.left, BENCH_OPTIONS);
  bench("projection.left(), building", building.left, BENCH_OPTIONS);
  bench("projection.isBuilding(entity), idle", idle.isBuilding, BENCH_OPTIONS);
  bench("projection.isBuilding(entity), building 300 views", building.isBuilding, BENCH_OPTIONS);
  bench("projection.built(), idle", idle.built, BENCH_OPTIONS);
  bench("projection.built(), building, two checks", building.built, BENCH_OPTIONS);
  bench("projection.startFrame(now), idle", idle.startFrame, BENCH_OPTIONS);
  bench("projection.startFrame(now), building", building.startFrame, BENCH_OPTIONS);
});
