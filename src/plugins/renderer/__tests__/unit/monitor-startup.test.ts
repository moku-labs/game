/* eslint-disable unicorn/no-null -- a frame record and a log line are JSON: "not measured" is null. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { linesOf, startAgent } from "../perf-harness";

// ---------------------------------------------------------------------------
// Unit: the startup line (spec 11 R10): parse, evaluate, the Pixi chunk, init,
// the first drawn frame and the boot long frames, from the page's timeline.
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const BUNDLE = "https://game.local/assets/main-9c41e0.js";

/** The page's timeline: one navigation, the bundle's resource entry and the marks. */
function stubTimeline(marks: Record<string, { startTime: number; detail?: unknown }>): void {
  vi.spyOn(globalThis.performance, "getEntriesByType").mockImplementation(type => {
    if (type === "navigation") return [{ responseEnd: 120.5 } as unknown as PerformanceEntry];
    if (type === "resource") {
      return [
        {
          name: BUNDLE,
          responseEnd: 300,
          transferSize: 204_800,
          decodedBodySize: 614_400
        } as unknown as PerformanceEntry
      ];
    }

    return [];
  });
  vi.spyOn(globalThis.performance, "getEntriesByName").mockImplementation(name => {
    const mark = marks[name];

    return mark === undefined ? [] : [mark as unknown as PerformanceEntry];
  });
}

describe("the startup line", () => {
  it("measures the page from download to the first drawn frame, once, after the header", async () => {
    stubTimeline({
      "moku:script": { startTime: 482.4, detail: BUNDLE },
      "moku:main": { startTime: 578.5 },
      "moku:pixi-start": { startTime: 600 },
      "moku:pixi-end": { startTime: 641 },
      "moku:init-start": { startTime: 650 },
      "moku:init-end": { startTime: 713.2 }
    });
    const agent = await startAgent();
    const lines = agent.listen();

    agent.frame({ at: 1200, workMs: 40.5 });
    agent.frame({ at: 2300 });
    agent.frame({ at: 3400 });

    expect(linesOf(lines, "startup")).toHaveLength(1);
    expect(linesOf(lines, "startup")[0]).toMatchObject({
      htmlMs: 120.5,
      script: { url: BUNDLE, fetchEndMs: 300, transferKb: 200, decodedKb: 600 },
      parseMs: 182.4,
      evaluateMs: 96.1,
      pixiMs: 41,
      initMs: 63.2,
      firstFrameMs: 1240.5,
      longFrames: null
    });

    const later = agent.listen();

    expect(later.map(line => line.kind)).toEqual(["header", "startup"]);
  });

  it("leaves the script fields null without the mark of the bundle", async () => {
    stubTimeline({ "moku:main": { startTime: 578.5 } });
    const agent = await startAgent();
    const lines = agent.listen();

    agent.frame({ at: 0 });
    agent.frame({ at: 1000 });

    expect(linesOf(lines, "startup")[0]).toMatchObject({
      script: null,
      parseMs: null,
      evaluateMs: null,
      pixiMs: null
    });
  });
});
