import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import { initialOnlyAsksFixture, initialOnlyStillFixture } from "./fixtures";

describe("initialOnly", () => {
  bench("50 fades asking for their muted fields", initialOnlyAsksFixture(), BENCH_OPTIONS);
  bench("still frame over 300 views after their fade", initialOnlyStillFixture(), BENCH_OPTIONS);
});
