import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AgentRenderer } from "../perf-harness";
import { BUDGET, NOISE } from "./budgets";
import { bytesPerCall, monitorFrame, startPlainAgent, steadyFrame } from "./fixtures";

// ---------------------------------------------------------------------------
// Perf: the per-frame path of the monitor of an agent build (spec 11 "the per-frame path allocates nothing", R5 of
// change 2026-10-18-cheap-idle-tick): `begin`, `end` and the commit of one frame, no stream listener. The `alloc` twin
// of the steady frame of `unit/monitor-alloc.test.ts`; that probe stays and keeps the flush and the spike budgets.
// The page clock is held inside one second, so no flush runs in a window: the flush builds lines and may allocate.
// ---------------------------------------------------------------------------

let agent: AgentRenderer;

beforeAll(async () => {
  agent = await startPlainAgent();
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe("the monitor's frame", () => {
  it("allocates nothing on a steady frame without a listener", () => {
    const record = steadyFrame();

    expect(bytesPerCall(() => monitorFrame(agent, record))).toBeLessThanOrEqual(
      BUDGET.monitorCommitSteady + NOISE
    );
  });

  it("allocates nothing on a late frame, the gap spike annotated and kept for the stream", () => {
    const record = steadyFrame(30);

    expect(bytesPerCall(() => monitorFrame(agent, record))).toBeLessThanOrEqual(
      BUDGET.monitorCommitLate + NOISE
    );
  });
});
