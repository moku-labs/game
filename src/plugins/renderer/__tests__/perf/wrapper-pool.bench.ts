import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import { closingWindow } from "./close-detach.fixture";
import { destroyedTrip, pooledTrip } from "./wrapper-pool.fixture";

const pooled = pooledTrip().trip;
const destroyed = destroyedTrip();
const album = await closingWindow(1000, 120);

describe("a wrapper of a parent view leaves and the next parent gets one (hot path 2в)", () => {
  bench("through the pool: reset, stored, taken back (real Pixi)", pooled, BENCH_OPTIONS);
  bench("before 2в: destroyed, a new Container made (real Pixi)", destroyed, BENCH_OPTIONS);
  bench(
    "an album-sized window of 481 views opens and closes over 1000 views",
    album,
    BENCH_OPTIONS
  );
});
