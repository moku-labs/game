import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import { sdfSyncStage } from "../sdf-text-stage";

const frame = sdfSyncStage(20);

describe("the uniform sync of SDF texts", () => {
  bench("20 texts, as a frame draws them", frame, BENCH_OPTIONS);
});
