import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import { buildWaiting, reactionWaiting } from "./fixtures";

const waiting = await buildWaiting();
const reacting = await reactionWaiting();

describe("scenes: the frame callback of a scene build", () => {
  bench("the build is not done", waiting, BENCH_OPTIONS);
  bench("the reaction frame is not drawn", reacting, BENCH_OPTIONS);
});
