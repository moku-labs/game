import { bench, describe } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import { fadeMount } from "./fade-mount.fixture";

const mount = fadeMount();

describe("ui overlay fade from its mount frame (F205)", () => {
  bench("level written, rest of the track", mount, BENCH_OPTIONS);
});
