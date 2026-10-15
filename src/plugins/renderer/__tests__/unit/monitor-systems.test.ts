import { afterEach, describe, expect, it, vi } from "vitest";
import type { SystemTiming } from "../../../world/types";
import { frameAt } from "../../monitor/ring";
import { linesOf, startAgent } from "../perf-harness";

// ---------------------------------------------------------------------------
// Unit: the time per world system in the log (spec 11 H2b.4): the five slowest
// systems of a frame in the ring and in its spike, the five highest means of a
// second in the sample.
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** A timing table of seven systems. */
function timing(ms: number[]): SystemTiming {
  return {
    clock: () => 0,
    names: [
      "ward.pan",
      "ward.fog",
      "board.drop",
      "board.glow",
      "hud.coins",
      "hud.bar",
      "ui.layout"
    ],
    ms: Float64Array.from(ms)
  };
}

describe("the slowest systems of a frame", () => {
  it("land in the ring and in the frame's spike with their names, the slowest first", async () => {
    const agent = await startAgent({ config: { monitor: { budgetMs: 16.7, frames: 64 } } });
    const lines = agent.listen();

    agent.mock.setSystemTimes(timing([0.1, 0.9, 0.3, 0.5, 0.2, 0.7, 0.4]));
    agent.frame({ at: 0, workMs: 30 });

    const expected = [
      { name: "ward.fog", ms: 0.9 },
      { name: "hud.bar", ms: 0.7 },
      { name: "board.glow", ms: 0.5 },
      { name: "ui.layout", ms: 0.4 },
      { name: "board.drop", ms: 0.3 }
    ];

    expect(frameAt(agent.mock.api.monitor.frames(), 0)?.systems).toEqual(expected);

    agent.mock.modules.monitor.flush();

    expect(linesOf(lines, "spike")[0]?.systems).toEqual(expected);
  });

  it("make a sample carry the five systems of the second with the highest mean, and their slowest run", async () => {
    const agent = await startAgent();
    const lines = agent.listen();
    const table = timing([0, 0, 0, 0, 0, 0, 0]);

    agent.mock.setSystemTimes(table);
    table.ms.set([1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.1]);
    agent.frame({ at: 0 });
    table.ms.set([3, 0.2, 0.3, 0.4, 0.5, 0.6, 0.1]);
    agent.frame({ at: 500 });
    agent.frame({ at: 1000 });

    expect(linesOf(lines, "sample")[0]?.systems).toEqual([
      { name: "ward.pan", mean: 2, max: 3 },
      { name: "hud.bar", mean: 0.6, max: 0.6 },
      { name: "hud.coins", mean: 0.5, max: 0.5 },
      { name: "board.glow", mean: 0.4, max: 0.4 },
      { name: "board.drop", mean: 0.3, max: 0.3 }
    ]);
  });

  it("are null in the ring and the sample without a timing table, and the header does not list them", async () => {
    const agent = await startAgent();
    const lines = agent.listen();

    agent.frame({ at: 0 });
    agent.frame({ at: 1000 });

    expect(frameAt(agent.mock.api.monitor.frames(), 0)?.systems).toBeNull();
    expect(linesOf(lines, "sample")[0]?.systems).toBeNull();
    expect(linesOf(lines, "header")[0]?.measured).not.toContain("systems");
  });
});
