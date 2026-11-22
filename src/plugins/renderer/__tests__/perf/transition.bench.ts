import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import { playingTransition } from "./transition-fixtures";

// As in `transition.perf.ts`: one renderer per kind, its transition playing for a day.
const fade = await playingTransition("fade");
const slide = await playingTransition("slide");
const wipe = await playingTransition("wipe");
const iris = await playingTransition("iris");
const dissolve = await playingTransition("dissolve");

describe("the step of a transition while it plays", () => {
  bench("one step of a fade", fade.step, BENCH_OPTIONS);

  bench("one step of a slide", slide.step, BENCH_OPTIONS);

  bench("one step of a wipe, on its body", wipe.step, BENCH_OPTIONS);

  bench("one step of an iris, on its body", iris.step, BENCH_OPTIONS);

  bench("one step of a dissolve, on its body", dissolve.step, BENCH_OPTIONS);
});
