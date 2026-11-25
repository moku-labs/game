import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import {
  frostDirtyBoard,
  frostIdleBoard,
  frostLiveBoard,
  frostMovingBoard,
  frostSteppedBoard,
  frostTweenBoard
} from "./frost-fixtures";

const idle = await frostIdleBoard();
const stepped = await frostSteppedBoard();
const dirty = await frostDirtyBoard();
const moving = await frostMovingBoard();
const live = await frostLiveBoard();
const tween = await frostTweenBoard();

describe("eight frosted windows over a Source (F126 stage 5)", () => {
  bench("a flush with no dirty Source", idle, BENCH_OPTIONS);
  bench("every window steps over its cached Source", stepped, BENCH_OPTIONS);
  bench("a mark inside the Source, walked up to it", dirty, BENCH_OPTIONS);
  bench("eight windows slide, their placement written in place", moving, BENCH_OPTIONS);
  bench(
    "the room changes every frame: taken, the shared result drawn in place",
    live,
    BENCH_OPTIONS
  );
});
