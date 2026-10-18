import { beforeAll, describe, expect, it, vi } from "vitest";
import type { AgentRenderer } from "../perf-harness";
import { BUDGET, NOISE } from "./budgets";
import { bytesPerCall, monitorFrame, startPlainAgent, steadyFrame } from "./fixtures";

// ---------------------------------------------------------------------------
// Perf: the switchable sections of the monitor and their cost (spec 11 R14, N1 and N2 of change
// 2026-10-18-cheap-idle-tick). Timing every section of the commit adds clock reads, never an object: a steady frame
// costs nothing with every section on, and nothing with every one off. A read of the switches answers one object.
// ---------------------------------------------------------------------------

let agent: AgentRenderer;

beforeAll(async () => {
  vi.stubGlobal("__MOKU_GAME_CONTROL__", true);
  agent = await startPlainAgent();
});

describe("the monitor's sections", () => {
  it("allocate nothing on a steady frame with every section on, each one timed", () => {
    const record = steadyFrame();

    expect(bytesPerCall(() => monitorFrame(agent, record))).toBeLessThanOrEqual(
      BUDGET.monitorSectionsOn + NOISE
    );
  });

  it("allocate nothing on a steady frame with every section off", () => {
    const record = steadyFrame();

    agent.mock.api.monitor.sections({
      gpu: false,
      passes: false,
      shaders: false,
      problems: false,
      memory: false,
      systems: false,
      nodes: false,
      longFrames: false
    });

    expect(bytesPerCall(() => monitorFrame(agent, record))).toBeLessThanOrEqual(
      BUDGET.monitorSectionsOff + NOISE
    );
  });

  it("allocate nothing on a read of the switches", () => {
    expect(bytesPerCall(() => agent.mock.api.monitor.sections())).toBeLessThanOrEqual(
      BUDGET.monitorSectionsRead + NOISE
    );
  });
});
