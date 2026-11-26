import { bench, describe, vi } from "vitest";
import { BENCH_OPTIONS } from "../../../../../tests/perf/alloc";
import type { EdgeClock } from "./edge-fixtures";

// An agent build: the timer's guards pass. Each edge gets its own instance of the runner modules, as a page runs one
// kind of edge for its whole life.
vi.stubGlobal("__MOKU_GAME_AGENT__", true);

/**
 * Builds the edge on a fresh instance of the runner modules.
 *
 * @param clock - Which page clock times it.
 * @returns The call that takes the edge once.
 */
async function freshEdge(clock: EdgeClock): Promise<() => void> {
  vi.resetModules();

  const { edgeCall } = await import("./edge-fixtures");

  return edgeCall(clock);
}

const untimed = await freshEdge("untimed");
const stub = await freshEdge("stub");
const page = await freshEdge("performance");

describe("commitEdge of the merge drag's drop (hot-path item 8)", () => {
  bench("untimed", untimed, BENCH_OPTIONS);
  bench("timed, stub page clock", stub, BENCH_OPTIONS);
  bench("timed, performance.now()", page, BENCH_OPTIONS);
});
