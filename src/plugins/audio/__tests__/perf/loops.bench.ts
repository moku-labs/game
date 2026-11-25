import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import { leaveOtherScene, leaveTwoLoops, leaveWithoutLoops, loopChurn, sameLoop } from "./fixtures";

const without = leaveWithoutLoops();
const other = leaveOtherScene();
const two = leaveTwoLoops();
const churn = loopChurn();
const same = sameLoop();

describe("audio: stopSceneLoops", () => {
  bench("a scene no loop belongs to", without, BENCH_OPTIONS);
  bench("two loops of another scene", other, BENCH_OPTIONS);
  bench("two loops of the scene that leaves (and put back)", two, BENCH_OPTIONS);
  bench("control: the put-back and plain deletes", churn, BENCH_OPTIONS);
});

describe("audio: isSameLoop", () => {
  bench("the bed that already plays under the id", same, BENCH_OPTIONS);
});
