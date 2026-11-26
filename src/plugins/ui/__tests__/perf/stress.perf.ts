import { appendFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { alloc } from "../../../../../tests/perf/alloc";
import { SIZES } from "./stress";
import { type StressPerf, split, startStress } from "./stress.fixture";

// ---------------------------------------------------------------------------
// Change 2026-11-26-hot-path-research: the album sheet at 572, 1 180 and 1 960 elements and an event popup of 150
// elements over it. A research file: it reports the heap bytes a frame keeps and the ms of each system, and asserts
// only what holds today, so a later change that makes a frame grow with the size of the root is caught.
// ---------------------------------------------------------------------------

/** Calls of a window: a step is a whole frame of 1 to 6 ms. */
const CALLS = 100;

/** The app of the running test, stopped after it. */
let running: StressPerf | undefined;

afterEach(async () => {
  await running?.stop();
  running = undefined;
});

describe.each(SIZES)("the album of $sets sets, a whole frame of the app", ({ name }) => {
  it("reports the bytes and the ms per system of a still frame, a turn, a swipe step and a popup", async ({
    annotate
  }) => {
    // The bytes of a release build: an agent build adds its own timing and monitor writes.
    const release = await startStress(name, false);

    running = release;

    const bytes = {
      still: Math.round(alloc(release.still, 20_000)),
      turn: Math.round(alloc(release.turn, CALLS)),
      // 80 and its half 40 are whole 20-step cycles: the delayed child placement (spec 33 G) churns ~16 entity-keyed Maps at the V8 shrink threshold.
      swipe: Math.round(alloc(release.swipe, 80)),
      popup: Math.round(alloc(release.popup, CALLS))
    };

    await release.stop();

    const perf = await startStress(name);

    running = perf;

    const report = {
      elements: perf.elements,
      bytes,
      ms: {
        still: split(perf, perf.still, 150),
        turn: split(perf, perf.turn, 150),
        peek: split(perf, perf.swipe, 300, perf.peeked),
        popup: split(perf, perf.popup, 150)
      }
    };

    // A research run names a file to keep the numbers in: `STRESS_OUT=/path/to/stress.jsonl`.
    const out = process.env.STRESS_OUT;

    if (out !== undefined) appendFileSync(out, `${JSON.stringify({ name, ...report })}\n`);

    await annotate(JSON.stringify(report));

    // Bug caught: a frame in which nothing changed that allocates per element of a root at rest.
    expect(report.bytes.still).toBeLessThanOrEqual(2048);
  }, 600_000);
});
