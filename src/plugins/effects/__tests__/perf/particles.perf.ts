import { describe, expect, it } from "vitest";
import { BUDGET, NOISE } from "./budgets";
import { bytesPerCall, particlesFixture } from "./fixtures";

// ---------------------------------------------------------------------------
// Perf: the particle system of `effects` (change 2026-10-18-cheap-idle-tick, E2) — three local-space emitters
// following a still host, their streams held, then emitting.
// ---------------------------------------------------------------------------

describe("effects:particles, heap bytes per frame step", () => {
  it("3 emitters following a still host, streams held", () => {
    const { run } = particlesFixture(false);

    expect(bytesPerCall(run)).toBeLessThanOrEqual(BUDGET.particlesStill + NOISE);
  });

  it("3 streams emitting while they follow a still host", () => {
    const { run } = particlesFixture(true);

    expect(bytesPerCall(run)).toBeLessThanOrEqual(BUDGET.particlesEmitting + NOISE);
  });
});
