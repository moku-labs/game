import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import { unseenBoard } from "./fixtures";

const still = await unseenBoard();
const moving = await unseenBoard(true);

describe("the unseen walk", () => {
  bench("a still board: 20 views, two loops each, and the still pass", still, BENCH_OPTIONS);
  bench("a moving board: every view walked again", moving, BENCH_OPTIONS);
});
