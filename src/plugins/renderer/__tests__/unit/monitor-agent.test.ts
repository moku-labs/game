import { afterEach, describe, expect, it, vi } from "vitest";
import { frameAt } from "../../monitor/ring";
import { FAKE_PNG } from "../fake-pixi";
import { createMockRenderer } from "../mock-renderer";
import { type AgentRenderer, startAgent } from "../perf-harness";

// ---------------------------------------------------------------------------
// Unit: the agent phase (spec 11 R8.9, editor review point 2): the overlay's
// own work is its own phase, charged to the frame interval it falls in, left
// out of both spike rules and handed to `time.chargeAgent`.
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const budget = { budgetMs: 16.7, frames: 64 } as const;

/** One span of the agent's own work of `ms` page-clock milliseconds. */
function span(agent: AgentRenderer, ms: number): void {
  agent.mock.api.monitor.beginAgent();
  agent.clock.now += ms;
  agent.mock.api.monitor.endAgent();
}

describe("beginAgent and endAgent", () => {
  it("put the span into the next record and charge it to time once", async () => {
    const agent = await startAgent({ config: { monitor: budget } });

    agent.clock.now = 100;
    agent.mock.api.monitor.beginAgent();
    agent.clock.now = 100.07;
    agent.mock.api.monitor.endAgent();
    agent.frame({ workMs: 2 });

    const record = frameAt(agent.mock.api.monitor.frames(), 0);

    expect(record?.phases.agent).toBeCloseTo(0.07, 5);
    expect(agent.mock.charged).toHaveLength(1);
    expect(agent.mock.charged[0]).toBeCloseTo(0.07, 5);

    agent.frame({ workMs: 2 });
    expect(frameAt(agent.mock.api.monitor.frames(), 0)?.phases.agent).toBe(0);
  });

  it("ignore a begin while a span is open and an end without one", async () => {
    const agent = await startAgent({ config: { monitor: budget } });

    agent.mock.api.monitor.endAgent();
    agent.clock.now = 10;
    agent.mock.api.monitor.beginAgent();
    agent.clock.now = 11;
    agent.mock.api.monitor.beginAgent();
    agent.clock.now = 12;
    agent.mock.api.monitor.endAgent();
    agent.mock.api.monitor.endAgent();
    agent.frame({ workMs: 1 });

    expect(frameAt(agent.mock.api.monitor.frames(), 0)?.phases.agent).toBe(2);
    expect(agent.mock.charged).toEqual([2]);
  });
});

describe("a capture's picture (F62)", () => {
  it("is taken after the frame, not inside it, and charged to the agent", async () => {
    const agent = await startAgent({ config: { monitor: budget } });
    const extract = agent.mock.pixi.last().renderer.extract;
    const encode = extract.base64;

    // A slow phone: the draw and read-back of the extract takes 180 ms of the page clock.
    extract.base64 = (options: unknown) => {
      agent.clock.now += 180;
      return encode(options);
    };
    agent.clock.now = 100;
    const pending = agent.mock.api.capture();

    agent.frame({ workMs: 2 });

    expect(extract.calls).toHaveLength(0);
    expect(agent.mock.charged).toEqual([]);

    await expect(pending).resolves.toEqual({ png: FAKE_PNG });

    expect(extract.calls).toHaveLength(1);
    expect(agent.mock.charged).toEqual([180]);

    agent.frame({ workMs: 2 });

    expect(frameAt(agent.mock.api.monitor.frames(), 0)?.phases.agent).toBe(180);
  });
});

describe("the agent's work and the spike rules", () => {
  it("leaves the agent's work out of the js rule", async () => {
    const agent = await startAgent({ config: { monitor: budget } });

    span(agent, 2);
    agent.frame({ workMs: 18 });
    expect(frameAt(agent.mock.api.monitor.frames(), 0)?.causes).toEqual([]);

    span(agent, 1);
    agent.frame({ workMs: 18 });
    expect(frameAt(agent.mock.api.monitor.frames(), 0)?.causes).toEqual(["js"]);
  });

  it("leaves the agent's work between two frames out of the gap rule", async () => {
    const agent = await startAgent({ config: { monitor: budget } });

    span(agent, 3);
    agent.frame({ gapMs: 27, capMs: 16.7, workMs: 1 });
    expect(frameAt(agent.mock.api.monitor.frames(), 0)?.causes).toEqual([]);

    span(agent, 1);
    agent.frame({ gapMs: 27, capMs: 16.7, workMs: 1 });
    expect(frameAt(agent.mock.api.monitor.frames(), 0)?.causes).toEqual(["gap"]);
  });
});

describe("the agent members without the flag", () => {
  it("read no clock and charge nothing", async () => {
    const now = vi.spyOn(globalThis.performance, "now");
    const mock = createMockRenderer();

    await mock.start();
    now.mockClear();
    mock.api.monitor.beginAgent();
    mock.api.monitor.endAgent();
    mock.api.monitor.mark("shop open");
    mock.api.monitor.event("scene", { from: "home", to: "board" });

    expect(now).not.toHaveBeenCalled();
    expect(mock.charged).toEqual([]);
    expect(mock.api.monitor.frames().capacity).toBe(0);
    expect(mock.api.monitor.stream(() => undefined)).toBeTypeOf("function");
  });
});
