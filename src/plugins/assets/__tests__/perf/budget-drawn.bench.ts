import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import { lookupHit, pickHalfDrawn } from "./fixtures";

const hit = await lookupHit();
const pick = await pickHalfDrawn();

describe("assets: the texture budget and its provider (F184)", () => {
  bench("lookupTexture: a key of a loaded bundle", hit, BENCH_OPTIONS);
  bench("pickVictim: 20 loaded bundles, half drawn", pick, BENCH_OPTIONS);
});
