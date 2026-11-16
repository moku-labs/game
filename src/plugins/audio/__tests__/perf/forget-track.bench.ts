import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import { forgetLeft, forgetPlaying } from "./fixtures";

const playing = forgetPlaying();
const left = forgetLeft();

describe("audio: forgetTrack", () => {
  bench("the track that plays stays", playing, BENCH_OPTIONS);
  bench("a key that left is dropped (and put back)", left, BENCH_OPTIONS);
});
