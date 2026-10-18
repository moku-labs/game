/* eslint-disable unicorn/no-null -- a frame rate is JSON: an unknown display is null. */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FrameRate, RateChange } from "../../../time/types";
import { linesOf, startAgent } from "../perf-harness";

// ---------------------------------------------------------------------------
// Unit: the adaptive frame rate in the performance log of an agent build (spec
// 21 G7.2, G7.5): every `time:rate` is one `rate` event line, and the header
// carries the rate the loop runs at.
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const change: RateChange = {
  from: 120,
  to: 60,
  reason: "missed",
  mode: "auto",
  displayHz: 120,
  thermal: "none",
  window: { drawn: 41, missed: 9, heavy: 0 },
  dwellMs: 5000,
  scale: 1
};

describe("the rate line", () => {
  it("a time:rate becomes one rate event line with the payload as detail", async () => {
    const agent = await startAgent();
    const lines = agent.listen();

    agent.mock.hooks["time:rate"](change);

    expect(linesOf(lines, "event").filter(line => line.name === "rate")).toEqual([
      expect.objectContaining({ kind: "event", name: "rate", detail: change })
    ]);
  });

  it("is not written after the renderer stopped", async () => {
    const agent = await startAgent();
    const lines = agent.listen();

    agent.mock.stop();
    agent.mock.hooks["time:rate"](change);

    expect(linesOf(lines, "event").filter(line => line.name === "rate")).toEqual([]);
  });
});

describe("the scale line", () => {
  // Bug: the log of a phone run never says when the canvas drew at another resolution for the rate, nor why.
  it("a time:rate that moves the render scale is also a scale line; one that keeps it is not", async () => {
    const agent = await startAgent();
    const lines = agent.listen();

    agent.mock.hooks["time:rate"]({ ...change, from: 120, to: 120, scale: 0.85 });
    agent.mock.hooks["time:rate"]({ ...change, scale: 0.85 });

    expect(linesOf(lines, "event").filter(line => line.name === "scale")).toEqual([
      expect.objectContaining({
        kind: "event",
        name: "scale",
        detail: { from: 1, to: 0.85, reason: "missed", fps: 120 }
      })
    ]);
  });
});

describe("the header", () => {
  it("carries the rate the loop runs at", async () => {
    const rate: Readonly<FrameRate> = Object.freeze({
      fps: 120,
      mode: "auto",
      reason: "start",
      displayHz: 120,
      ladder: Object.freeze([120, 60]),
      thermal: null,
      asked: null,
      heldBy: null,
      scale: 1
    });
    const agent = await startAgent();

    agent.mock.setRate(rate);

    expect(linesOf(agent.listen(), "header")[0]?.rate).toEqual(rate);
  });
});
