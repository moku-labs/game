import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import { initialOnlyAsksFixture, initialOnlyStillFixture } from "./fixtures";

describe("initialOnly", () => {
  bench("50 fades asking for their muted fields", initialOnlyAsksFixture(), BENCH_OPTIONS);
  bench("still frame over 300 views after their fade", initialOnlyStillFixture(), BENCH_OPTIONS);
  bench(
    "50 fades asking, half the views covered by a when",
    initialOnlyAsksFixture(true),
    BENCH_OPTIONS
  );
  bench(
    "still frame over 300 views, half covered by a when",
    initialOnlyStillFixture(true),
    BENCH_OPTIONS
  );
});
