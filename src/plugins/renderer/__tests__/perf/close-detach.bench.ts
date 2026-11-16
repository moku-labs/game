import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import { closingWindow } from "./close-detach.fixture";

const small = await closingWindow(100, 40);
const large = await closingWindow(1000, 40);
const album = await closingWindow(1000, 120);

describe("the close of a window: its root leaves among other views (F195)", () => {
  bench("a window of 161 views (40 panels) over 100 views", small, BENCH_OPTIONS);
  bench("a window of 161 views (40 panels) over 1000 views", large, BENCH_OPTIONS);
  bench("a window of 481 views (120 panels, album-sized) over 1000 views", album, BENCH_OPTIONS);
});
