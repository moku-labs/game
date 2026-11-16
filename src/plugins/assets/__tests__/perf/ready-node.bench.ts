import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import { readyNodeNoAsk, readyNodeRestWithoutReady } from "./fixtures";

const noAsk = readyNodeNoAsk();
const restWithoutReady = readyNodeRestWithoutReady();

describe("assets: a node entered past the ready ask (F204)", () => {
  bench("no ask waits", noAsk, BENCH_OPTIONS);
  bench("the rest after a transit ask does not list ready", restWithoutReady, BENCH_OPTIONS);
});
