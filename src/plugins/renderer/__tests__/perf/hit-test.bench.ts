import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import type { Entity } from "../../../world/types";
import { hoverBoard } from "./fixtures";

const board = await hoverBoard();
const { hitTest } = board.mock.api.sync;
const none = (): boolean => false;
const isTarget = (entity: Entity): boolean => entity === board.target;

describe("the hover hit test over a board of 540 views", () => {
  bench("a miss: every view walked", () => void hitTest(500, 20, none), BENCH_OPTIONS);
  bench(
    "a drop lookup: the bottom slot under its item",
    () => void hitTest(board.drop.x, board.drop.y, isTarget),
    BENCH_OPTIONS
  );
});
