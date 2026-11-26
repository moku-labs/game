import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AgentRenderer } from "../perf-harness";
import { BUDGET, NOISE } from "./budgets";
import {
  bytesPerCall,
  edgeFrame,
  monitorFrame,
  startEdgeAgent,
  startPlainAgent,
  steadyFrame
} from "./fixtures";

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

// ---------------------------------------------------------------------------
// The flow edges of a frame (change 2026-11-26-hp-8-flow-timer): `commitEdges` reads `flow.edgeTimes()` in every frame.
// A frame with none since the previous commit is one compare; a frame with two takes them into its columns and the
// second's sums, its costliest node's path interned the first time and read from the map after.
// ---------------------------------------------------------------------------

describe("the monitor's frame with the flow's edges", () => {
  let timed: AgentRenderer;

  beforeAll(async () => {
    timed = await startEdgeAgent();
  });

  it("allocates nothing on a steady frame when no edge came", () => {
    const record = steadyFrame();

    expect(bytesPerCall(() => monitorFrame(timed, record))).toBeLessThanOrEqual(
      BUDGET.monitorCommitNoEdges + NOISE
    );
  });

  it("allocates nothing on a steady frame with two edges before it", () => {
    const record = steadyFrame();

    expect(bytesPerCall(() => edgeFrame(timed, record))).toBeLessThanOrEqual(
      BUDGET.monitorCommitEdges + NOISE
    );
  });
});
