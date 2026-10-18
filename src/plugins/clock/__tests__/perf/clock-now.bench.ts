import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import { dateNowIntoField, stillReadIntoField, systemReadIntoField } from "./fixtures";

describe("clock.now()", () => {
  bench("now() over the system source", systemReadIntoField(), BENCH_OPTIONS);
  bench("now() over a still source", stillReadIntoField(), BENCH_OPTIONS);
  bench("Date.now() alone", dateNowIntoField(), BENCH_OPTIONS);
});
