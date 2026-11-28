import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import { buildInline, resolveDefined, resolveInline } from "./resolve.fixture";

describe("ui: resolve one style for a pressed element (hp-2ab)", () => {
  bench("inline style, built for the call as a render builds it", resolveInline, BENCH_OPTIONS);
  bench("the inline style built only, for the difference", buildInline, BENCH_OPTIONS);
  bench("defined style, its frozen edges handed out as they are", resolveDefined, BENCH_OPTIONS);
});
