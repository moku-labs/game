import { afterEach, describe, expect, it, vi } from "vitest";
import type { PixiFilter } from "../../types";
import { FakeFilter, FakeFilterSystem, fakeExtensions, WEBGPU_SYSTEM } from "../fake-pixi";
import { type AgentRenderer, linesOf, startAgent } from "../perf-harness";

// ---------------------------------------------------------------------------
// Unit: the detail of a spike (spec 11 R4.3, R5, R6.1, editor review point 13):
// its compiles with label and time, its filters per kind, the kind's name on a
// pooled filter pass, its changes with their subject.
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Runs `work` in the render phase of the next frames. */
function duringRender(agent: AgentRenderer, work: () => void): void {
  agent.mock.frames.push({ phase: "render", callback: work });
}

/** The counting filter system the registry holds, made for one application. */
function filterSystem(): { applyFilter(...args: unknown[]): void } {
  const Counting = fakeExtensions.named(WEBGPU_SYSTEM, "filter") as unknown as new () => {
    applyFilter(...args: unknown[]): void;
  };

  return new Counting();
}

/** A filter input of 100 x 50 at resolution 2: 20 000 pixels. */
const input = { frame: { width: 100, height: 50 }, source: { resolution: 2 } };

describe("a spike's detail", () => {
  it("carries the compiles of its frame with their label and the time of the call", async () => {
    const agent = await startAgent({ config: { monitor: { budgetMs: 16.7, frames: 64 } } });
    const device = {
      features: new Set<string>(),
      createRenderPipeline: vi.fn(() => {
        agent.clock.now += 1.5;

        return {};
      }),
      createShaderModule: vi.fn(() => ({})),
      destroy: vi.fn()
    };

    agent.mock.ctx.state.host.ownGpu = { adapter: {} as GPUAdapter, device: device as never };
    agent.mock.modules.monitor.attach();
    duringRender(agent, () => {
      (device as unknown as GPUDevice).createRenderPipeline({ label: "sprite" } as never);
      (device as unknown as GPUDevice).createShaderModule({ code: "" });
    });

    const lines = agent.listen();

    agent.frame({ at: 0, workMs: 30 });
    agent.mock.modules.monitor.flush();

    expect(linesOf(lines, "spike")[0]?.compiles).toEqual([{ label: "sprite", ms: 1.5 }]);
    expect(linesOf(lines, "spike")[0]?.frame.compiles).toBe(1);
    expect(agent.pc.sinks.compiles.shaderModules).toBe(1);
  });

  it("carries its filters per kind, a slot without a kind as other, and names a pooled filter pass by its kind", async () => {
    const agent = await startAgent({ config: { monitor: { budgetMs: 16.7, frames: 64 } } });
    const glow = new FakeFilter() as unknown as PixiFilter;
    const plain = new FakeFilter() as unknown as PixiFilter;
    const filters = filterSystem();
    const Encoder = fakeExtensions.named(WEBGPU_SYSTEM, "encoder") as unknown as new (
      renderer: unknown
    ) => { beginRenderPass(target: unknown): unknown };
    const pooled = { isRoot: false, pixelWidth: 64, pixelHeight: 32 };
    const encoder = new Encoder({ renderTarget: { renderTarget: pooled } });

    agent.mock.api.sync.filters.set(7, [
      { filter: glow, passes: 1, kind: "effects.glow" },
      { filter: plain, passes: 1 }
    ]);
    FakeFilterSystem.onApply = () => {
      encoder.beginRenderPass({ descriptor: {} });
    };
    duringRender(agent, () => {
      filters.applyFilter(glow, input, {}, true);
      filters.applyFilter(glow, input, {}, true);
      filters.applyFilter(
        plain,
        { frame: { width: 100, height: 100 }, source: { resolution: 1 } },
        {},
        true
      );
    });

    const lines = agent.listen();

    agent.frame({ at: 0, workMs: 30 });
    agent.mock.modules.monitor.flush();

    const spike = linesOf(lines, "spike")[0];

    expect(spike?.filters).toEqual([
      { kind: "effects.glow", applies: 2, mpx: 0.04 },
      { kind: "other", applies: 1, mpx: 0.01 }
    ]);
    expect(spike?.frame.filters).toMatchObject({ applies: 3, mpx: 0.05 });
    expect(spike?.passes.map(pass => [pass.kind, pass.label, pass.w, pass.h])).toEqual([
      ["filter", "effects.glow", 64, 32],
      ["filter", "effects.glow", 64, 32],
      ["filter", "other", 64, 32]
    ]);
  });

  it("carries the subject of a change of its frame", async () => {
    const agent = await startAgent({ config: { monitor: { budgetMs: 16.7, frames: 64 } } });

    duringRender(agent, () => {
      agent.mock.api.monitor.event("bundle", { bundle: "garden-boss", action: "load" });
    });

    const lines = agent.listen();

    agent.frame({ at: 0, workMs: 30 });
    agent.mock.modules.monitor.flush();

    expect(linesOf(lines, "spike")[0]?.frame.changed).toEqual([
      { kind: "bundle", what: "garden-boss" }
    ]);
    expect(linesOf(lines, "event")[0]).toMatchObject({
      name: "bundle",
      frame: 1,
      detail: { bundle: "garden-boss", action: "load" }
    });
  });
});
