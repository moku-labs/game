import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import {
  crowdWaitingBoard,
  cutZoomBoard,
  idleAwayBoard,
  keptAncestorFadeBoard,
  keptBlendBoard,
  keptBoard,
  keptFadeBoard,
  keptFractionalBoard,
  keptOwnFadeBoard,
  keptSteppedBoard,
  keptWhyBoard,
  keptZoomBoard
} from "./fixtures";

const calm = await keptBoard(10);
const marked = await keptBoard(10, true);
const fading = await keptFadeBoard(10);
const ownFading = await keptOwnFadeBoard(10);
const zooming = await keptZoomBoard(10);
const glowing = await keptBlendBoard(10);
const underFade = await keptAncestorFadeBoard(10);
const cutZoom = await cutZoomBoard();
const idleAway = await idleAwayBoard(10);
const crowd = await crowdWaitingBoard(10);
const noted = await keptWhyBoard(10);
const fractional = await keptFractionalBoard(40);
const steppedToFraction = await keptSteppedBoard(40, 1.5);

describe("the kept flush of a quiet board", () => {
  bench("10 kept views, a calm frame", calm, BENCH_OPTIONS);
  bench("10 kept views stepped, a mark elsewhere", marked, BENCH_OPTIONS);
  bench("10 kept views, one fading through its alpha", fading, BENCH_OPTIONS);
  bench("10 kept views, one fading through its own alpha (F120)", ownFading, BENCH_OPTIONS);
  bench("10 kept views under a camera zoom (F67)", zooming, BENCH_OPTIONS);
  bench("10 kept views stepped under a translucent root (F113)", underFade, BENCH_OPTIONS);
  bench("a panorama cut to the canvas, live under a zoom (F113)", cutZoom, BENCH_OPTIONS);
  bench("10 views with an alpha off the canvas, stepped (F114)", idleAway, BENCH_OPTIONS);
  bench("a crowd of 10 live views waiting for their first take (F119)", crowd, BENCH_OPTIONS);
  bench("10 live views changed every frame, their reasons noted (F126)", noted, BENCH_OPTIONS);
  bench("40 kept views stepped at a fractional resolution", fractional, BENCH_OPTIONS);
  bench("40 kept views stepped after a step to a fraction", steppedToFraction, BENCH_OPTIONS);
  bench(
    "10 kept views and a glowing filtered view drawn live, stepped (F68)",
    glowing,
    BENCH_OPTIONS
  );
});
