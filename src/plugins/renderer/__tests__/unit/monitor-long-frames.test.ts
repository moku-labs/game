/* eslint-disable unicorn/no-null -- a long frame of the log is JSON: "not measured" is null. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { linesOf, startAgent } from "../perf-harness";

// ---------------------------------------------------------------------------
// Unit: Long Animation Frames (spec 11 R9): the observer of the browser's best
// entry type, the ring of 64 with the top three scripts, the `longFrame` line.
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** The fake `PerformanceObserver`: the entry types it supports, the last one made. */
function stubObserver(types: string[]): { deliver(entries: object[]): void; options(): unknown } {
  const made: Array<{ callback: (list: { getEntries(): object[] }) => void; options: unknown }> =
    [];

  class FakeObserver {
    public static readonly supportedEntryTypes = types;
    private readonly record: (typeof made)[number];

    public constructor(callback: (list: { getEntries(): object[] }) => void) {
      this.record = { callback, options: undefined };
      made.push(this.record);
    }

    public observe(options: unknown): void {
      this.record.options = options;
    }

    public disconnect(): void {}
  }

  vi.stubGlobal("PerformanceObserver", FakeObserver);

  return {
    deliver: entries => {
      for (const record of made) record.callback({ getEntries: () => entries });
    },
    options: () => made[0]?.options
  };
}

/** A script of a LoAF entry. */
function script(invoker: string, duration: number) {
  return {
    invoker,
    invokerType: "event-listener",
    sourceURL: "https://game.local/main.js",
    sourceFunctionName: `on${invoker}`,
    sourceCharPosition: 120,
    duration,
    forcedStyleAndLayoutDuration: 1
  };
}

describe("long frames", () => {
  it("are observed with script attribution, buffered, and kept with their three longest scripts", async () => {
    const observer = stubObserver(["long-animation-frame", "longtask"]);
    const agent = await startAgent();
    const lines = agent.listen();

    agent.frame({ at: 100, workMs: 40 });
    observer.deliver([
      {
        startTime: 90,
        duration: 80,
        blockingDuration: 30,
        renderStart: 150,
        styleAndLayoutStart: 160,
        scripts: [script("tap", 10), script("load", 40), script("tick", 5), script("fetch", 20)]
      }
    ]);

    expect(observer.options()).toEqual({ type: "long-animation-frame", buffered: true });
    expect(linesOf(lines, "longFrame")[0]).toMatchObject({
      startMs: 90,
      durationMs: 80,
      blockingMs: 30,
      renderStartMs: 60,
      styleLayoutMs: 70,
      frames: [1, 1]
    });
    expect(linesOf(lines, "longFrame")[0]?.scripts.map(entry => [entry.invoker, entry.ms])).toEqual(
      [
        ["load", 40],
        ["fetch", 20],
        ["tap", 10]
      ]
    );
    expect(linesOf(lines, "longFrame")[0]?.scripts[0]).toEqual({
      invoker: "load",
      type: "event-listener",
      source: "https://game.local/main.js",
      fn: "onload",
      ms: 40,
      forcedLayoutMs: 1
    });
  });

  it("come as long tasks without blocking time and scripts where the browser has no LoAF", async () => {
    const observer = stubObserver(["longtask"]);
    const agent = await startAgent();
    const lines = agent.listen();

    observer.deliver([{ startTime: 500, duration: 60 }]);
    agent.frame({ at: 0 });
    agent.frame({ at: 1000 });

    expect(observer.options()).toEqual({ type: "longtask", buffered: true });
    expect(linesOf(lines, "longFrame")[0]).toMatchObject({
      blockingMs: null,
      renderStartMs: null,
      scripts: [],
      frames: null
    });
    expect(linesOf(lines, "sample")[0]?.longFrames).toEqual({
      count: 1,
      maxMs: 60,
      blockingMs: null
    });
  });

  it("are null in a sample where the browser reports neither", async () => {
    stubObserver(["mark", "measure"]);
    const agent = await startAgent();
    const lines = agent.listen();

    agent.frame({ at: 0 });
    agent.frame({ at: 1000 });

    expect(linesOf(lines, "sample")[0]?.longFrames).toBeNull();
    expect(linesOf(lines, "header")[0]?.measured).not.toContain("longFrames");
  });
});
