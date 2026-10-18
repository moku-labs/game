/* eslint-disable unicorn/no-null -- a frame record and a log line are JSON: "not measured" is null. */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PerfEventLine } from "../../monitor/log-types";
import { frameAt } from "../../monitor/ring";
import type { FrameTimer } from "../../monitor/types";
import { type AgentRenderer, linesOf, startAgent } from "../perf-harness";

// ---------------------------------------------------------------------------
// Unit: the switchable sections of the monitor and their cost (spec 11 R14, change 2026-10-18-cheap-idle-tick N1,
// N2). A section switched off skips its work from the next frame on and its columns read as not measured; the header
// and a `sections` event say which are off; a write needs control; the sample carries what each section cost.
// ---------------------------------------------------------------------------

const MB = 1024 * 1024;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Reflect.deleteProperty(globalThis.performance, "memory");
});

/** Every section on, as the monitor starts. */
const ALL_ON = {
  gpu: true,
  passes: true,
  counts: true,
  systems: true,
  longFrames: true,
  heap: true
};

/**
 * Starts an agent build of a page with control (`--debug`), whose frames draw one pass with two batches and a draw.
 *
 * @returns The started agent build.
 */
async function startControlled(): Promise<AgentRenderer> {
  vi.stubGlobal("__MOKU_GAME_CONTROL__", true);

  return startAgent({ scene: { passes: 1, batches: 2, draws: 1 } });
}

/**
 * The `sections` events a listener got.
 *
 * @param lines - The lines.
 * @returns Their details.
 */
function sectionEvents(lines: Parameters<typeof linesOf>[0]): PerfEventLine["detail"][] {
  return linesOf(lines, "event")
    .filter(line => line.name === "sections")
    .map(line => line.detail);
}

describe("monitor.sections", () => {
  it("answers every section on, and a config's sections from the first frame on", async () => {
    const plain = await startAgent();

    expect(plain.mock.api.monitor.sections()).toEqual(ALL_ON);

    const configured = await startAgent({
      config: { monitor: { budgetMs: "rate", frames: 64, sections: { systems: false } } }
    });
    const lines = configured.listen();

    configured.mock.setSystemTimes({ clock: () => 0, names: ["ward.pan"], ms: Float64Array.of(1) });
    configured.frame({ at: 0 });

    expect(configured.mock.api.monitor.sections()).toEqual({ ...ALL_ON, systems: false });
    expect(frameAt(configured.mock.api.monitor.frames(), 0)?.systems).toBeNull();
    expect(linesOf(lines, "header")[0]?.sections).toEqual({
      on: ["gpu", "passes", "counts", "longFrames", "heap"],
      off: ["systems"]
    });
  });

  it("switches counts off from the next frame with control: its columns read not measured, an event says so", async () => {
    const agent = await startControlled();
    const lines = agent.listen();
    const ring = agent.mock.api.monitor.frames();

    agent.frame({ at: 0 });
    expect(frameAt(ring, 0)?.draws).toBe(3);

    expect(agent.mock.api.monitor.sections({ counts: false })).toEqual({
      ...ALL_ON,
      counts: false
    });
    expect(sectionEvents(lines)).toEqual([
      { on: ["gpu", "passes", "systems", "longFrames", "heap"], off: ["counts"] }
    ]);

    agent.frame({ at: 10 });

    const record = frameAt(ring, 0);

    expect(record).toMatchObject({
      draws: null,
      filters: null,
      uploads: null,
      compiles: null,
      marks: null,
      rebuilds: null,
      reason: null
    });
    // The counting classes counted no draw of the frame: the dev counter of stats() saw none.
    expect(agent.mock.api.stats().drawCalls).toBe(0);
    // A listener that comes now reads in its header which sections are off.
    expect(linesOf(agent.listen(), "header")[0]?.sections).toEqual({
      on: ["gpu", "passes", "systems", "longFrames", "heap"],
      off: ["counts"]
    });

    agent.mock.api.monitor.sections({ counts: true });
    agent.frame({ at: 20 });

    expect(frameAt(ring, 0)?.draws).toBe(3);
    expect(sectionEvents(lines)).toHaveLength(2);
  });

  it("writes nothing for a switch that changes nothing, and answers the same object", async () => {
    const agent = await startControlled();
    const lines = agent.listen();
    const before = agent.mock.api.monitor.sections();

    expect(agent.mock.api.monitor.sections({ counts: true })).toBe(before);
    expect(sectionEvents(lines)).toEqual([]);
  });

  it("refuses a write without control: the sections stay, the log says read-only, no event is written", async () => {
    const agent = await startAgent({ scene: { passes: 1, batches: 2, draws: 1 } });
    const lines = agent.listen();

    expect(agent.mock.api.monitor.sections({ counts: false })).toEqual(ALL_ON);
    expect(agent.mock.log.warn).toHaveBeenCalledWith(
      expect.stringContaining("read-only"),
      expect.objectContaining({ reason: "read-only" })
    );

    agent.frame({ at: 0 });

    expect(frameAt(agent.mock.api.monitor.frames(), 0)?.draws).toBe(3);
    expect(sectionEvents(lines)).toEqual([]);
  });

  it("answers every section on and keeps them in a build without the agent flag", async () => {
    const { createMockRenderer } = await import("../mock-renderer");
    const mock = createMockRenderer();

    vi.stubGlobal("__MOKU_GAME_CONTROL__", true);
    await mock.start();

    expect(mock.api.monitor.sections({ heap: false })).toEqual(ALL_ON);
  });

  it("with passes off keeps no pass of the frame and reads its pass columns as not measured", async () => {
    const agent = await startControlled();
    const passes = agent.mock.api.monitor.frames().passes;

    agent.frame({ at: 0 });

    const written = passes.written;

    agent.mock.api.monitor.sections({ passes: false });
    agent.frame({ at: 10 });

    expect(passes.written).toBe(written);
    expect(frameAt(agent.mock.api.monitor.frames(), 0)).toMatchObject({
      passes: null,
      stencilPasses: null,
      draws: 3
    });
    // The pass count of stats() is the renderer's own, in every build: it goes on.
    expect(agent.mock.api.stats().renderPasses).toBe(1);
  });

  it("with systems off writes no system of a frame or a second", async () => {
    const agent = await startControlled();
    const lines = agent.listen();

    agent.mock.setSystemTimes({ clock: () => 0, names: ["ward.pan"], ms: Float64Array.of(1) });
    agent.mock.api.monitor.sections({ systems: false });
    agent.frame({ at: 0 });
    agent.frame({ at: 1000 });

    expect(frameAt(agent.mock.api.monitor.frames(), 0)?.systems).toBeNull();
    expect(linesOf(lines, "sample")[0]?.systems).toBeNull();
  });

  it("with heap off reads no heap: no gc? hint after a drop, the sample's heap null", async () => {
    const agent = await startControlled();
    const lines = agent.listen();
    const heap = { bytes: 64 * MB, reads: 0 };

    Object.defineProperty(globalThis.performance, "memory", {
      configurable: true,
      get: () => {
        heap.reads += 1;

        return { usedJSHeapSize: heap.bytes };
      }
    });
    agent.mock.api.monitor.sections({ heap: false });
    agent.frame({ at: 0, gapMs: 16.7, workMs: 1 });
    heap.bytes -= MB;
    agent.frame({ at: 40, gapMs: 40, workMs: 1 });
    agent.frame({ at: 1000 });

    expect(frameAt(agent.mock.api.monitor.frames(), 1)?.causes).toEqual(["gap"]);
    expect(linesOf(lines, "sample")[0]?.heapMb).toBeNull();
    expect(heap.reads).toBe(0);
  });

  it("with gpu off hands no frame to the GPU timer", async () => {
    const agent = await startControlled();
    const timer: FrameTimer = {
      kind: "timestamp-query",
      commit: vi.fn(),
      close: vi.fn(),
      stop: vi.fn()
    };

    agent.pc.perf.timer = timer;
    agent.frame({ at: 0 });
    expect(timer.commit).toHaveBeenCalledTimes(1);

    agent.mock.api.monitor.sections({ gpu: false });
    agent.frame({ at: 10 });

    expect(timer.commit).toHaveBeenCalledTimes(1);
  });

  it("with longFrames off keeps no long frame: the sample counts none and no line is written", async () => {
    const observed: Array<(list: { getEntries(): object[] }) => void> = [];

    /** The browser's observer of long frames, as the long-frame tests fake it. */
    class FakeObserver {
      public static readonly supportedEntryTypes = ["long-animation-frame"];

      public constructor(callback: (list: { getEntries(): object[] }) => void) {
        observed.push(callback);
      }

      public observe(): void {}

      public disconnect(): void {}
    }

    vi.stubGlobal("PerformanceObserver", FakeObserver);

    const agent = await startControlled();
    const lines = agent.listen();

    agent.mock.api.monitor.sections({ longFrames: false });
    agent.frame({ at: 0 });

    for (const callback of observed) {
      callback({ getEntries: () => [{ startTime: 0, duration: 80, scripts: [] }] });
    }

    agent.frame({ at: 1000 });

    expect(linesOf(lines, "longFrame")).toEqual([]);
    expect(linesOf(lines, "sample")[0]?.longFrames).toBeNull();
    expect(agent.pc.perf.longFrames.size).toBe(0);
  });
});

describe("the cost of the sections", () => {
  it("is in every sample: page-clock ms a second for each section and the base, an off section 0", async () => {
    const agent = await startControlled();
    const lines = agent.listen();
    let now = 0;

    agent.mock.setSystemTimes({ clock: () => 0, names: ["ward.pan"], ms: Float64Array.of(1) });
    // A page clock that moves on by 0.25 ms at every read: every lap of the commit takes time.
    vi.mocked(globalThis.performance.now).mockImplementation(() => {
      now += 0.25;

      return now;
    });
    agent.mock.api.monitor.sections({ heap: false });
    agent.frame({ at: 0 });
    agent.frame({ at: 500 });
    agent.frame({ at: 1000 });

    const cost = linesOf(lines, "sample")[0]?.sectionsMs;

    expect(Object.keys(cost ?? {}).toSorted()).toEqual(
      ["base", "counts", "gpu", "heap", "longFrames", "passes", "systems"].toSorted()
    );
    expect(cost?.heap).toBe(0);
    expect(cost?.counts).toBeGreaterThan(0);
    expect(cost?.systems).toBeGreaterThan(0);
    expect(cost?.base).toBeGreaterThan(0);

    for (const value of Object.values(cost ?? {})) expect(value).toBeGreaterThanOrEqual(0);
  });
});
