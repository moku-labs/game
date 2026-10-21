import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import { heldRangeBoard, unseenBoard } from "./fixtures";

const still = await unseenBoard();
const moving = await unseenBoard(true);
const held = await heldRangeBoard();

describe("the unseen walk", () => {
  bench("a still board: 20 views, two loops each, and the still pass", still, BENCH_OPTIONS);
  bench("a moving board: every view walked again", moving, BENCH_OPTIONS);
});

describe("the loops under a sheet that holds them", () => {
  bench("20 views under a resting dim-only sheet with hold over a sharp ward", held, BENCH_OPTIONS);
});
