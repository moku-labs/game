import { describe, expect, it } from "vitest";
import { alloc } from "../../../../../tests/perf/alloc";
import { startTrackFixture } from "./fixtures";

/**
 * Bytes per start + end of a 2-field absolute track over an older owner of both fields, measured
 * on the code before change 2026-11-24-f230-hot-path (A1): the pairs array of `claimFields`, nine
 * `ArrayBuffer`s per track, `Object.keys` in `dropField`.
 */
const BEFORE = 6212;

/** What it measures now: one buffer per track, no pairs array, no `Object.keys` in `dropField`. */
const NOW = 4050;

/** Room over `NOW` for the noise of a run: about 5 %. */
const MARGIN = 200;

describe("anim startTrack: heap bytes per start + end", () => {
  it("starts a 2-field track over an older owner and ends the older one, below the before-value", () => {
    const bytes = alloc(startTrackFixture());

    expect(bytes).toBeLessThan(BEFORE);
    expect(bytes).toBeLessThanOrEqual(NOW + MARGIN);
  });
});
