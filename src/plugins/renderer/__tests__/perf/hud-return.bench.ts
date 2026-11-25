import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import { returnBoard } from "./fixtures";

const standing = await returnBoard("standing");
const running = await returnBoard("running");
const ended = await returnBoard("ended");

describe("the HUD return (F240)", () => {
  bench("stepParts, 3 parts, no run", ended.parts, BENCH_OPTIONS);
  bench("stepParts, 3 parts, 1 run in its delay", running.parts, BENCH_OPTIONS);
  bench("the overlay step of a landed overlay with hudReturn", standing.step, BENCH_OPTIONS);
  bench("the overlay step of a run in progress, record gone", running.step, BENCH_OPTIONS);
  bench("the overlay step after the run ended", ended.step, BENCH_OPTIONS);
});
