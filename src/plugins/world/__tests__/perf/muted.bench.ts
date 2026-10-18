import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import { mutedFixture } from "./fixtures";

describe("muted fields", () => {
  bench("50 unmuted tracks", mutedFixture(false), BENCH_OPTIONS);
  bench("50 muted tracks with an owned field", mutedFixture(true), BENCH_OPTIONS);
});
