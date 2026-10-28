import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import {
  cutZoomBoard,
  keptAncestorFadeBoard,
  keptBlendBoard,
  keptBoard,
  keptFadeBoard,
  keptZoomBoard
} from "./fixtures";

const calm = await keptBoard(10);
const marked = await keptBoard(10, true);
const fading = await keptFadeBoard(10);
const zooming = await keptZoomBoard(10);
const glowing = await keptBlendBoard(10);
const underFade = await keptAncestorFadeBoard(10);
const cutZoom = await cutZoomBoard();

describe("the kept flush of a quiet board", () => {
  bench("10 kept views, a calm frame", calm, BENCH_OPTIONS);
  bench("10 kept views stepped, a mark elsewhere", marked, BENCH_OPTIONS);
  bench("10 kept views, one fading through its alpha", fading, BENCH_OPTIONS);
  bench("10 kept views under a camera zoom (F67)", zooming, BENCH_OPTIONS);
  bench("10 kept views stepped under a translucent root (F113)", underFade, BENCH_OPTIONS);
  bench("a panorama cut to the canvas, live under a zoom (F113)", cutZoom, BENCH_OPTIONS);
  bench(
    "10 kept views and a glowing filtered view drawn live, stepped (F68)",
    glowing,
    BENCH_OPTIONS
  );
});
