import { afterEach, describe, expect, it, vi } from "vitest";
import type { FrameMeasure } from "../../../time/types";
import { frameAt } from "../../monitor/ring";
import { type AgentRenderer, linesOf, startAgent } from "../perf-harness";

// ---------------------------------------------------------------------------
// Unit: the gap rule against the display (D6, spec 11 R8.5): the budget is one
// frame of the rate the loop can reach, max(rate, display), the display from
// the ticks while `time` does not know it; a wake frame is judged against the
// idle cap before it; a hidden page, a throttled page and a still screen are
// not judged.
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const AT_120 = 1000 / 120;
const AT_60 = 1000 / 60;
const AT_30 = 1000 / 30;

/** Commits one drawn frame and answers its causes. */
function causesOf(agent: AgentRenderer, record: Partial<FrameMeasure>): readonly string[] {
  agent.frame(record);

  return frameAt(agent.mock.api.monitor.frames(), 0)?.causes ?? [];
}

describe("the budget against the display", () => {
  it("makes no gap spike from frame 3 at maxFps 120 on 16.67 ms ticks, the display guessed from the ticks", async () => {
    const agent = await startAgent();
    const causes: (readonly string[])[] = [];

    for (let index = 0; index < 6; index += 1) {
      const gapMs = index === 0 ? Number.NaN : AT_60;

      causes.push(causesOf(agent, { gapMs, rateMs: AT_120, capMs: AT_120 }));
    }

    expect(causes).toEqual([[], ["gap"], [], [], [], []]);
    expect(frameAt(agent.mock.api.monitor.frames(), 0)?.budgetMs).toBeCloseTo(AT_60, 2);
  });

  it("still makes a 16.7 ms gap a spike on 8.33 ms ticks, also after frames that skipped a tick", async () => {
    const plain = await startAgent();

    for (let index = 0; index < 4; index += 1) {
      causesOf(plain, { gapMs: AT_120, rateMs: AT_120, capMs: AT_120 });
    }

    expect(causesOf(plain, { gapMs: 16.7, rateMs: AT_120, capMs: AT_120 })).toEqual(["gap"]);

    // A 60 fps loop on a 120 Hz panel: each frame spans two ticks of 8.33 ms; then the rate goes back to 120 (its
    // first frame is judged against the 60 fps cap before it).
    const skipping = await startAgent();
    const at120 = { rateMs: AT_120, capMs: AT_120 };

    for (let index = 0; index < 9; index += 1) {
      causesOf(skipping, { gapMs: AT_60, skipped: 1, rateMs: AT_60, capMs: AT_60 });
    }

    causesOf(skipping, { gapMs: AT_120, ...at120 });
    expect(causesOf(skipping, { gapMs: 16.7, ...at120 })).toEqual(["gap"]);
  });

  it("takes time's display period from the first frame, and never the ticks' guess once time knows the display", async () => {
    const slowPanel = await startAgent();

    causesOf(slowPanel, { rateMs: AT_120, capMs: AT_120, displayMs: AT_60 });

    expect(
      causesOf(slowPanel, { gapMs: AT_60, rateMs: AT_120, capMs: AT_120, displayMs: AT_60 })
    ).toEqual([]);
    expect(frameAt(slowPanel.mock.api.monitor.frames(), 0)?.budgetMs).toBeCloseTo(AT_60, 2);

    // A 120 Hz panel whose loop only reaches 60: the ticks look like 60 Hz, time knows better.
    const busy = await startAgent();
    const record = { gapMs: AT_60, rateMs: AT_120, capMs: AT_120, displayMs: AT_120 };

    for (let index = 0; index < 9; index += 1) causesOf(busy, record);

    expect(causesOf(busy, record)).toEqual(["gap"]);
    expect(frameAt(busy.mock.api.monitor.frames(), 0)?.budgetMs).toBeCloseTo(AT_120, 2);
  });
});

describe("a wake frame", () => {
  it("is judged against the idle cap before it: after 30 fps idle a 33.3 ms gap is none, 51 ms is one", async () => {
    const agent = await startAgent();
    const idle = { gapMs: AT_30, capMs: AT_30, idle: true, skipped: 1 };

    causesOf(agent, idle);
    expect(causesOf(agent, { gapMs: 33.3, capMs: AT_60 })).toEqual([]);

    causesOf(agent, idle);
    expect(causesOf(agent, { gapMs: 51, capMs: AT_60 })).toEqual(["gap"]);
  });
});

describe("a gap that says nothing", () => {
  it("is not judged while the page is hidden", async () => {
    const agent = await startAgent();

    causesOf(agent, { gapMs: AT_60 });
    vi.stubGlobal("document", { hidden: true });
    expect(causesOf(agent, { gapMs: 100 })).toEqual([]);

    vi.stubGlobal("document", { hidden: false });
    expect(causesOf(agent, { gapMs: 100 })).toEqual(["gap"]);
  });

  it("is not judged on a throttled page: this gap and the previous over 500 ms with little work", async () => {
    const agent = await startAgent();

    causesOf(agent, { gapMs: AT_60, workMs: 1 });
    expect(causesOf(agent, { gapMs: 1000, workMs: 1 })).toEqual(["gap"]);
    expect(causesOf(agent, { gapMs: 1000, workMs: 1 })).toEqual([]);
    expect(causesOf(agent, { gapMs: 1000, workMs: 10 })).toEqual(["gap"]);
  });

  it("is not judged between two frames that drew nothing, and is again for the frame that draws", async () => {
    const agent = await startAgent();
    const ring = agent.mock.api.monitor.frames();
    const undrawn = (gapMs: number): readonly string[] => {
      agent.mock.measureFrame({ gapMs });

      return frameAt(ring, 0)?.causes ?? [];
    };

    causesOf(agent, { gapMs: AT_60 });
    expect(undrawn(40)).toEqual(["gap"]);
    expect(undrawn(40)).toEqual([]);
    expect(frameAt(ring, 0)?.drawn).toBe(false);
    expect(causesOf(agent, { gapMs: 40 })).toEqual(["gap"]);
    expect(frameAt(ring, 0)?.drawn).toBe(true);
  });
});

describe("a sample's missed gaps", () => {
  it("are the frames of the gap rule: rate 120 on a 60 Hz panel misses none, a late frame one", async () => {
    const agent = await startAgent();
    const lines = agent.listen();
    const at60 = { rateMs: AT_120, capMs: AT_120, displayMs: AT_60 };

    for (let index = 0; index < 60; index += 1) {
      const gapMs = index === 0 ? Number.NaN : AT_60;

      agent.frame({ at: index * AT_60, gapMs, ...at60 });
    }

    // The frame that closes the first second came 40 ms after the one before it: the second second's one miss.
    agent.frame({ at: 1000, gapMs: 40, ...at60 });

    for (let index = 1; index <= 60; index += 1) {
      agent.frame({ at: 1000 + index * AT_60, gapMs: AT_60, ...at60 });
    }

    const samples = linesOf(lines, "sample");

    expect(samples[0]?.frames).toBe(60);
    expect(samples[0]?.gaps).toEqual({ missed: 0, drawn: 0, idle: 0 });
    expect(samples[1]?.gaps).toEqual({ missed: 1, drawn: 1, idle: 0 });
  });
});
