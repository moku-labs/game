/* eslint-disable unicorn/no-null -- a frame record and a log line are JSON: "not measured" is null. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { PERF_CAUSES } from "../../monitor/log-types";
import { frameAt } from "../../monitor/ring";
import { COUNT, MEASURE } from "../../monitor/types";
import { linesOf, startAgent } from "../perf-harness";

// ---------------------------------------------------------------------------
// Unit: the frame ring of an agent build (spec 11 R8): what a commit writes,
// how it wraps, what `frameAt` answers, and the spike rule at its boundaries.
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const AT_120 = 1000 / 120;

describe("the frame ring", () => {
  it("fills the marks and the reason columns from the draw decision of the frame", async () => {
    const agent = await startAgent({ config: { onDemand: true } });

    agent.frame({ at: 0, workMs: 2, rateMs: AT_120 });
    agent.mock.modules.demand.markLoose(42);
    agent.frame({ at: AT_120, workMs: 2, rateMs: AT_120 });
    agent.mock.ctx.state.viewport.resizePending = true;
    agent.frame({ at: 2 * AT_120, workMs: 2, rateMs: AT_120 });

    const ring = agent.mock.api.monitor.frames();

    expect([0, 1, 2].map(age => frameAt(ring, age))).toMatchObject([
      { drawn: true, reason: "resize", marks: 0 },
      { drawn: false, reason: "none", marks: 1 },
      { drawn: true, reason: "first", marks: 0 }
    ]);
  });

  it("writes each column of every frame and wraps at its capacity", async () => {
    const agent = await startAgent({ config: { monitor: { budgetMs: "rate", frames: 64 } } });

    for (let index = 0; index < 70; index += 1) {
      agent.frame({
        at: index * AT_120,
        gapMs: AT_120,
        workMs: 2.5,
        rateMs: AT_120,
        capMs: AT_120
      });
    }

    const ring = agent.mock.api.monitor.frames();

    expect(ring.capacity).toBe(64);
    expect(ring.size).toBe(64);
    expect(ring.written).toBe(70);
    expect(ring.newest).toBe(69 % 64);
    expect(ring.columns.frame[ring.newest]).toBe(70);
    expect(ring.columns.rateMs[ring.newest]).toBeCloseTo(8.33, 2);
    expect(ring.columns.t[ring.newest]).toBeCloseTo(69 * AT_120, 5);
    expect(agent.mock.api.monitor.frames()).toBe(ring);
  });

  it("answers a plain record of a slot: NaN as null, bits as names, the path id as the path", async () => {
    const agent = await startAgent();

    agent.mock.setPath("board/awaitIntent");
    agent.mock.hooks["flow:edge"]();
    agent.mock.ctx.state.viewport.resizePending = true;
    agent.frame({ at: 100, workMs: 3, rateMs: AT_120 });

    const ring = agent.mock.api.monitor.frames();
    const record = frameAt(ring, 0);

    expect(record).toMatchObject({
      frame: 1,
      t: 100,
      gapMs: null,
      rateMs: 8.33,
      budgetMs: 8.33,
      workMs: 3,
      drawn: true,
      stepped: false,
      // The draw decision of the frame: onDemand is off, nothing was marked.
      reason: "always",
      passes: 0,
      compiles: null,
      marks: 0,
      // The counting classes of the agent build count Pixi's rebuilds from the attach on (spec 26 R2.3).
      rebuilds: 0,
      systems: null,
      gpuMs: null,
      gpuPartial: false,
      path: "board/awaitIntent",
      changed: [{ kind: "resize", what: null }],
      causes: []
    });
    expect(frameAt(ring, 1)).toBeUndefined();
    expect(frameAt(ring, -1)).toBeUndefined();
  });
});

describe("the spike rule", () => {
  it("draws the gap line at half a budget over the larger of budget and cap", async () => {
    const agent = await startAgent({ config: { monitor: { budgetMs: 16.7, frames: 64 } } });
    const ring = agent.mock.api.monitor.frames();
    const causesOf = (gapMs: number, capMs: number): readonly string[] => {
      agent.frame({ gapMs, capMs, workMs: 1, idle: capMs > 20 });

      return frameAt(ring, 0)?.causes ?? [];
    };

    expect(causesOf(25, 16.7)).toEqual([]);
    expect(causesOf(25.1, 16.7)).toEqual(["gap"]);
    expect(causesOf(50, 1000 / 30)).toEqual([]);
    expect(causesOf(50.1, 1000 / 30)).toEqual(["gap"]);
  });

  it("makes a frame whose work runs over the budget a js spike, and a stepped frame none", async () => {
    const agent = await startAgent({ config: { monitor: { budgetMs: 16.7, frames: 64 } } });
    const ring = agent.mock.api.monitor.frames();

    agent.frame({ workMs: 16.7 });
    expect(frameAt(ring, 0)?.causes).toEqual([]);

    agent.frame({ workMs: 16.8 });
    expect(frameAt(ring, 0)?.causes).toEqual(["js"]);

    agent.frame({ workMs: 80, gapMs: Number.NaN, stepped: true });
    expect(frameAt(ring, 0)?.causes).toEqual([]);
  });

  it("annotates a spike with its compiles, its upload and an overlapping long frame, and no other frame", async () => {
    const agent = await startAgent({ config: { monitor: { budgetMs: 16.7, frames: 64 } } });
    const { pc } = agent;
    const ring = agent.mock.api.monitor.frames();
    const longFrame = pc.perf.longFrames.records[0];

    pc.perf.measuring |= MEASURE.compiles;
    agent.mock.frames.push({
      phase: "render",
      callback: () => {
        pc.sinks.counts[COUNT.compiles] = 1;
        pc.sinks.counts[COUNT.uploadBytes] = 2 * 1024 * 1024;
      }
    });

    if (longFrame === undefined) throw new Error("no record");

    Object.assign(longFrame, { startMs: 95, durationMs: 60 });
    pc.perf.longFrames.size = 1;
    pc.perf.longFrames.next = 1;

    agent.frame({ at: 100, workMs: 3 });
    expect(frameAt(ring, 0)?.causes).toEqual([]);

    agent.frame({ at: 120, workMs: 30 });
    expect(frameAt(ring, 0)?.causes).toEqual(["js", "compile", "upload", "longFrame"]);
  });

  it("annotates a gap spike with a compile of one of the 4 frames before it, not of the 5th, and no js spike", async () => {
    const agent = await startAgent({ config: { monitor: { budgetMs: 16.7, frames: 64 } } });
    const { pc } = agent;
    const ring = agent.mock.api.monitor.frames();
    const compiling = { now: false };
    const causesOf = (compile: boolean, gapMs: number, workMs = 1): readonly string[] => {
      compiling.now = compile;
      agent.frame({ gapMs, workMs });

      return frameAt(ring, 0)?.causes ?? [];
    };

    pc.perf.measuring |= MEASURE.compiles;
    agent.mock.frames.push({
      phase: "render",
      callback: () => {
        if (compiling.now) pc.sinks.counts[COUNT.compiles] = 1;
      }
    });

    expect(causesOf(true, 16.7)).toEqual([]);
    causesOf(false, 16.7);
    causesOf(false, 16.7);
    causesOf(false, 16.7);
    expect(causesOf(false, 40)).toEqual(["gap", "compile"]);

    // The bits as a reader of the column names them (PERF_CAUSES's example).
    const bits = ring.columns.causes[ring.newest] ?? 0;

    expect(bits).toBe(9);
    expect(PERF_CAUSES.filter((_cause, index) => (bits & (1 << index)) !== 0)).toEqual([
      "gap",
      "compile"
    ]);
    expect(causesOf(false, 40)).toEqual(["gap"]);

    causesOf(true, 16.7);
    expect(causesOf(false, 16.7, 30)).toEqual(["js"]);
  });

  it("keeps the newest 64 spikes waiting for the stream", async () => {
    const agent = await startAgent({ config: { monitor: { budgetMs: 16.7, frames: 1024 } } });

    for (let index = 0; index < 70; index += 1) agent.frame({ at: index * 10, workMs: 30 });

    const lines = agent.listen();

    agent.mock.modules.monitor.flush();

    const spikes = linesOf(lines, "spike");

    expect(spikes).toHaveLength(64);
    expect(spikes[0]?.frame.frame).toBe(7);
    expect(spikes.at(-1)?.frame.frame).toBe(70);
  });
});
