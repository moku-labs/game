import { afterEach, describe, expect, it, vi } from "vitest";
import { frameAt } from "../../monitor/ring";
import type { FakeRenderTarget } from "../fake-pixi";
import { type AgentRenderer, startAgent } from "../perf-harness";

// ---------------------------------------------------------------------------
// Unit: the render passes of WebGL (spec 11 R6.2): a pass is a bound target,
// seen on Pixi's public runners; the root counts when `bind` emitted nothing.
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const root: FakeRenderTarget = { isRoot: true, pixelWidth: 1080, pixelHeight: 1920 };

/** Runs `work` on Pixi's runners in the render phase of the next frame. */
function onRunners(agent: AgentRenderer, work: () => void): void {
  agent.mock.frames.push({ phase: "render", callback: work });
}

/** The runners of the application that draws. */
function runnersOf(agent: AgentRenderer) {
  const { renderer } = agent.mock.pixi.last();

  return { ...renderer.runners, change: renderer.renderTarget.onRenderTargetChange };
}

describe("WebGL passes", () => {
  it("count one for a render call that starts on the root with no target change", async () => {
    const agent = await startAgent({ kind: "webgl" });
    const runners = runnersOf(agent);

    onRunners(agent, () => {
      runners.prerender.emit();
      runners.renderStart.emit();
    });
    agent.frame({ workMs: 1 });

    const record = frameAt(agent.mock.api.monitor.frames(), 0);

    expect(record?.passes).toBe(1);
    expect(record?.stencilPasses).toBeNull();
    expect(record?.draws).toBeNull();
  });

  it("count three for a filter that binds a texture and goes back to the root", async () => {
    const agent = await startAgent({ kind: "webgl" });
    const runners = runnersOf(agent);
    const texture: FakeRenderTarget = { isRoot: false, pixelWidth: 512, pixelHeight: 512 };

    onRunners(agent, () => {
      runners.prerender.emit();
      runners.renderStart.emit();
      agent.pc.sinks.filterDepth = 1;
      runners.change.emit(texture);
      agent.pc.sinks.filterDepth = 0;
      runners.change.emit(root);
    });
    agent.frame({ workMs: 1 });

    expect(frameAt(agent.mock.api.monitor.frames(), 0)?.passes).toBe(3);
    expect([...agent.pc.perf.ring.passes.kind.subarray(0, 3)]).toEqual([0, 2, 0]);
    expect([...agent.pc.perf.ring.passes.stencil.subarray(0, 3)]).toEqual([255, 255, 255]);
  });

  it("count none between frames, and none on the root after a change at the start", async () => {
    const agent = await startAgent({ kind: "webgl" });
    const runners = runnersOf(agent);

    onRunners(agent, () => {
      runners.prerender.emit();
      runners.change.emit(root);
      runners.renderStart.emit();
    });
    agent.frame({ workMs: 1 });

    expect(frameAt(agent.mock.api.monitor.frames(), 0)?.passes).toBe(1);

    agent.mock.frames.pop();
    runners.prerender.emit();
    runners.renderStart.emit();
    runners.change.emit(root);

    expect(agent.pc.perf.ring.passes.written).toBe(1);
  });

  it("stop being counted when the monitor stops", async () => {
    const agent = await startAgent({ kind: "webgl" });
    const runners = runnersOf(agent);

    agent.mock.stop();

    expect(runners.prerender.items).toHaveLength(0);
    expect(runners.renderStart.items).toHaveLength(0);
    expect(runners.change.items).toHaveLength(0);
  });
});
