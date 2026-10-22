import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import { keptBoard, keptFadeBoard } from "./fixtures";

const calm = await keptBoard(10);
const marked = await keptBoard(10, true);
const fading = await keptFadeBoard(10);

describe("the kept flush of a quiet board", () => {
  bench("10 kept views, a calm frame", calm, BENCH_OPTIONS);
  bench("10 kept views stepped, a mark elsewhere", marked, BENCH_OPTIONS);
  bench("10 kept views, one fading through its alpha", fading, BENCH_OPTIONS);
});
