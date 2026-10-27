import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import { buildWaiting, loaderFading } from "./fixtures";

const waiting = await buildWaiting();
const fading = await loaderFading();

describe("scenes: the frame callback of a scene build", () => {
  bench("the build is not done", waiting, BENCH_OPTIONS);
});

describe("scenes: the frame callback of a loader fading out", () => {
  bench("the veil fades out", fading, BENCH_OPTIONS);
});
