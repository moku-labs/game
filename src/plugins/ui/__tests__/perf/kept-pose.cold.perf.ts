import { describe, expect, it } from "vitest";
import { allocCold } from "../../../../../tests/perf/alloc";
import { standingReposeCall, standingVisualCall } from "./kept-pose.fixture";

// ---------------------------------------------------------------------------
// Change 2026-11-26-f244-peek-pool, slice 1, cold tier: the calls of `kept-pose.perf.ts`, measured while V8 runs them
// unoptimized, as a phone runs engine code in its first seconds. What an optimized call erases (a boxed number) shows
// here; a value built again per call would show as one object or more.
// ---------------------------------------------------------------------------

/** Bytes `visualOf` of a standing shape keeps cold: measured 32 B on Node 24.21 (boxed numbers), and a margin. */
const COLD_SHAPE_BYTES = 64;

/** Bytes `visualOf` of a standing text keeps cold: measured 0 B on Node 24.21, and a margin of one small object. */
const COLD_TEXT_BYTES = 32;

/** Bytes `repose` of a standing element keeps cold: measured 288 B on Node 24.21 (the doubles of the scratch pose, boxed), and a margin. */
const COLD_REPOSE_BYTES = 350;

describe("ui: the kept values of an element that stands, heap bytes per call, cold", () => {
  it("visualOf of a standing shape and text and repose of a standing element stay small", async ({
    annotate
  }) => {
    // Bug caught: a value or a pose built again per call in unoptimized code.
    const shape = allocCold(standingVisualCall("shape"));
    const text = allocCold(standingVisualCall("text"));
    const pose = allocCold(standingReposeCall());

    await annotate(`cold: visualOf shape ${shape} B, text ${text} B, repose ${pose} B`);
    expect(shape).toBeLessThanOrEqual(COLD_SHAPE_BYTES);
    expect(text).toBeLessThanOrEqual(COLD_TEXT_BYTES);
    expect(pose).toBeLessThanOrEqual(COLD_REPOSE_BYTES);
  });
});
