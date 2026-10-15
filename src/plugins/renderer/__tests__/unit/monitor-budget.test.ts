import { afterEach, describe, expect, it, vi } from "vitest";
import { noteGpuTime } from "../../monitor/gpu-timer";
import { frameAt } from "../../monitor/ring";
import { linesOf, startAgent } from "../perf-harness";

// ---------------------------------------------------------------------------
// Unit: the per-frame spike budget (spec 11 R8.5, moved from spec 21): `"rate"`
// is one frame of the frame's own rate, a number a fixed line.
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Reflect.deleteProperty(globalThis.performance, "memory");
});

const AT_120 = 1000 / 120;
const AT_60 = 1000 / 60;

describe("budgetMs: rate", () => {
  it("makes an 11 ms frame a js spike at 120 fps and none at 60 fps", async () => {
    const agent = await startAgent();
    const ring = agent.mock.api.monitor.frames();

    agent.frame({ workMs: 11, rateMs: AT_120, capMs: AT_120 });
    expect(frameAt(ring, 0)?.causes).toEqual(["js"]);
    expect(frameAt(ring, 0)?.budgetMs).toBeCloseTo(AT_120, 2);

    agent.frame({ workMs: 11, rateMs: AT_60, capMs: AT_60 });
    expect(frameAt(ring, 0)?.causes).toEqual([]);
    expect(frameAt(ring, 0)?.budgetMs).toBeCloseTo(AT_60, 2);
  });

  it("keeps a fixed line of budgetMs 16.7 at 120 fps", async () => {
    const agent = await startAgent({ config: { monitor: { budgetMs: 16.7, frames: 64 } } });
    const ring = agent.mock.api.monitor.frames();

    agent.frame({ workMs: 11, rateMs: AT_120, capMs: AT_120 });

    expect(frameAt(ring, 0)?.causes).toEqual([]);
    expect(frameAt(ring, 0)?.budgetMs).toBe(16.7);
  });

  it("judges a late GPU time by the frame's own budget", async () => {
    const agent = await startAgent();
    const ring = agent.mock.api.monitor.frames();

    agent.frame({ workMs: 1, rateMs: AT_120 });
    ring.columns.gpuMs[ring.newest] = 10;
    noteGpuTime(agent.pc, ring.newest);
    expect(frameAt(ring, 0)?.causes).toEqual(["gpu"]);

    agent.frame({ workMs: 1, rateMs: AT_60 });
    ring.columns.gpuMs[ring.newest] = 10;
    noteGpuTime(agent.pc, ring.newest);
    expect(frameAt(ring, 0)?.causes).toEqual([]);
  });

  it("reads the frame's budget for the gc? hint", async () => {
    const agent = await startAgent();
    const ring = agent.mock.api.monitor.frames();
    let heap = 10 * 1024 * 1024;

    Object.defineProperty(globalThis.performance, "memory", {
      configurable: true,
      get: () => ({ usedJSHeapSize: heap })
    });

    agent.frame({ gapMs: 8, workMs: 1, rateMs: AT_120 });
    heap -= 0.6 * 1024 * 1024;
    agent.frame({ gapMs: 30, workMs: 5, rateMs: AT_120 });
    // 5 ms of work is more than half of 8.33: no hint.
    expect(frameAt(ring, 0)?.causes).toEqual(["gap"]);

    heap -= 0.6 * 1024 * 1024;
    agent.frame({ gapMs: 30, workMs: 5, rateMs: AT_60 });
    expect(frameAt(ring, 0)?.causes).toEqual(["gap", "gc?"]);
  });

  it("writes the newest frame's rateMs as the header's budgetMs, and the setting as its budget", async () => {
    const agent = await startAgent();

    agent.frame({ rateMs: AT_120, capMs: AT_120 });

    const header = linesOf(agent.listen(), "header")[0];

    expect(header?.config).toMatchObject({
      budgetMs: 8.33,
      budget: "rate",
      maxFps: 120,
      frames: 1024
    });
  });
});
