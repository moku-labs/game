/* eslint-disable unicorn/no-null -- a log line is JSON: "not measured" is null. */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FrameReadout } from "../../monitor/log-types";
import { frameAt } from "../../monitor/ring";
import { edgeRing, pushEdge } from "../edge-harness";
import { linesOf, startAgent } from "../perf-harness";

// ---------------------------------------------------------------------------
// Unit: the flow edges in the monitor of an agent build (change 2026-11-26-hp-8-flow-timer, §2): every commit takes
// the edges `flow.edgeTimes()` timed since the previous one into the frame's four ring columns; the flush writes one
// `edge` line per edge with a listener, the second's `sample.edges` with what the flow's ring overwrote first, and a
// spike carries the edges of its frame.
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** The page epoch ms of a page-clock time, as a line's `t` carries it. */
const epoch = (pageMs: number): number =>
  Math.round((globalThis.performance.timeOrigin + pageMs) * 100) / 100;

/** The four edge columns of a readout of `length` frames. */
function edgeReadout(length: number): FrameReadout & {
  edges: Uint16Array;
  edgeMs: Float32Array;
  edgeMaxMs: Float32Array;
  edgePath: Uint16Array;
} {
  return {
    length,
    edges: new Uint16Array(length),
    edgeMs: new Float32Array(length),
    edgeMaxMs: new Float32Array(length),
    edgePath: new Uint16Array(length)
  };
}

describe("the edges of a frame", () => {
  // Bug caught: a frame that does not take the edges timed since the previous commit, a maximum taken over the wrong
  // edge or its node not interned, edges taken again by the next frame, and `read` leaving the new columns out.
  it("are the edges timed before it: their count, their ms summed, the costliest and its node, taken once", async () => {
    const agent = await startAgent();
    const ring = edgeRing();

    agent.mock.setEdgeTimes(ring);
    agent.frame({ at: 0 });
    pushEdge(ring, "mergeBoard/awaitIntent", "drop", "mergeBoard/drop", { ms: 1.5 });
    pushEdge(ring, "mergeBoard/drop", "merged", "mergeBoard/awaitIntent", { ms: 4.25 });
    agent.frame({ at: 8 });
    agent.frame({ at: 16 });

    const frames = agent.mock.api.monitor.frames();

    expect(frameAt(frames, 1)?.edges).toEqual({
      count: 2,
      ms: 5.75,
      maxMs: 4.25,
      maxNode: "mergeBoard/drop"
    });
    expect(frameAt(frames, 0)?.edges).toBeNull();
    expect(frameAt(frames, 2)?.edges).toBeNull();

    const into = edgeReadout(3);

    frames.read(into, frames.written - 3);

    expect([...into.edges]).toEqual([0, 2, 0]);
    expect([...into.edgeMs]).toEqual([0, 5.75, 0]);
    expect([...into.edgeMaxMs]).toEqual([0, 4.25, 0]);
    expect(frames.paths[into.edgePath[1] ?? 0]).toBe("mergeBoard/drop");
  });

  // Bug caught: a slot the ring wraps onto keeps the edges of the frame it held before, and a page whose flow does not
  // time edges reads as "no edge" (0) instead of "not measured" (NaN).
  it("read 0 on a frame without one, also in a slot that held edges, and NaN where the flow does not time them", async () => {
    const agent = await startAgent({ config: { monitor: { budgetMs: "rate", frames: 64 } } });
    const ring = edgeRing();
    const into = edgeReadout(1);

    agent.mock.setEdgeTimes(ring);
    pushEdge(ring, "home", "play", "board", { ms: 2 });
    agent.frame({ at: 0 });

    for (let frame = 1; frame <= 64; frame += 1) agent.frame({ at: frame * 8 });

    const frames = agent.mock.api.monitor.frames();

    frames.read(into, frames.written - 1);

    expect(frameAt(frames, 0)?.edges).toBeNull();
    expect([into.edges[0], into.edgeMs[0], into.edgeMaxMs[0], into.edgePath[0]]).toEqual([
      0, 0, 0, 0
    ]);

    agent.mock.setEdgeTimes(undefined);
    agent.frame({ at: 600 });
    frames.read(into, frames.written - 1);

    expect(frameAt(frames, 0)?.edges).toBeNull();
    expect(into.edges[0]).toBe(0);
    expect(into.edgeMs[0]).toBeNaN();
    expect(into.edgeMaxMs[0]).toBeNaN();
  });
});

describe("the edges in the log", () => {
  // Bug caught: an edge line missing, built twice, carrying another frame or a swapped time, a NaN written as a number,
  // a line left unfrozen, and a second's summary that sums the wrong field or counts a body that did not run.
  it("are one frozen `edge` line per edge at the flush, with its frame, and the second's sum in `sample.edges`", async () => {
    const agent = await startAgent();
    const lines = agent.listen();
    const ring = edgeRing();

    agent.mock.setEdgeTimes(ring);
    agent.frame({ at: 0 });
    pushEdge(ring, "mergeBoard/awaitIntent", "drop", "mergeBoard/drop", {
      at: 400,
      ms: 0.42,
      commitMs: 0.18,
      hooksMs: 0.2,
      wallMs: 3120.5
    });
    pushEdge(ring, "mergeBoard/drop", "merged", "mergeBoard/awaitIntent", {
      at: 401,
      ms: 2.5,
      commitMs: 1,
      hooksMs: 1.25,
      bodyMs: 0.75,
      wallMs: 0.5
    });
    agent.frame({ at: 500 });

    const frame = frameAt(agent.mock.api.monitor.frames(), 0)?.frame;

    agent.frame({ at: 1000 });

    const edges = linesOf(lines, "edge");

    expect(edges).toEqual([
      {
        v: 1,
        kind: "edge",
        t: epoch(400),
        build: null,
        frame,
        node: "mergeBoard/awaitIntent",
        outcome: "drop",
        next: "mergeBoard/drop",
        ms: 0.42,
        commitMs: 0.18,
        hooksMs: 0.2,
        bodyMs: null,
        wallMs: 3120.5
      },
      {
        v: 1,
        kind: "edge",
        t: epoch(401),
        build: null,
        frame,
        node: "mergeBoard/drop",
        outcome: "merged",
        next: "mergeBoard/awaitIntent",
        ms: 2.5,
        commitMs: 1,
        hooksMs: 1.25,
        bodyMs: 0.75,
        wallMs: 0.5
      }
    ]);
    expect(Object.isFrozen(edges[0])).toBe(true);
    expect(linesOf(lines, "sample")[0]?.edges).toEqual({
      count: 2,
      ms: 2.92,
      bodyMs: 0.75,
      maxMs: 2.5,
      maxNode: "mergeBoard/drop",
      lost: 0
    });
  });

  // Bug caught: the edges the flow's ring overwrote before the flush not counted, counted again at the next flush, or
  // their lines built from slots that already hold newer edges.
  it("count the edges the flow's ring overwrote before the flush as `lost`, once", async () => {
    const agent = await startAgent();
    const lines = agent.listen();
    const ring = edgeRing();
    const times = { at: 1, ms: 0.5 };

    agent.mock.setEdgeTimes(ring);
    agent.frame({ at: 0 });

    for (let edge = 0; edge < 200; edge += 1) pushEdge(ring, "a", "next", "b", times);

    agent.frame({ at: 300 });

    for (let edge = 0; edge < 100; edge += 1) pushEdge(ring, "b", "next", "a", times);

    agent.frame({ at: 600 });
    agent.frame({ at: 1000 });

    const frames = agent.mock.api.monitor.frames();

    expect(frameAt(frames, 2)?.edges?.count).toBe(200);
    expect(linesOf(lines, "edge")).toHaveLength(256);
    expect(linesOf(lines, "edge")[0]?.node).toBe("a");
    expect(linesOf(lines, "sample")[0]?.edges).toMatchObject({ count: 300, lost: 44 });

    pushEdge(ring, "a", "next", "b", times);
    agent.frame({ at: 1500 });
    agent.frame({ at: 2000 });

    expect(linesOf(lines, "edge")).toHaveLength(257);
    expect(linesOf(lines, "sample")[1]?.edges).toMatchObject({ count: 1, lost: 0 });
  });

  // Bug caught: the frame that flushes takes its edges before the flush, so they are written and summed with a second
  // whose sample does not hold that frame.
  it("count the edges before the frame that flushes in the next second, as that frame", async () => {
    const agent = await startAgent();
    const lines = agent.listen();
    const ring = edgeRing();

    agent.mock.setEdgeTimes(ring);
    agent.frame({ at: 0 });
    pushEdge(ring, "home", "play", "board", { at: 990, ms: 1 });
    agent.frame({ at: 1000 });

    const frame = frameAt(agent.mock.api.monitor.frames(), 0)?.frame;

    expect(linesOf(lines, "edge")).toEqual([]);
    expect(linesOf(lines, "sample")[0]?.edges).toMatchObject({ count: 0, maxNode: null });

    agent.frame({ at: 2000 });

    expect(linesOf(lines, "edge").map(line => line.frame)).toEqual([frame]);
    expect(linesOf(lines, "sample")[1]?.edges).toMatchObject({ count: 1, maxNode: "home" });
  });

  // Bug caught: a listener that subscribes later gets the edges of the seconds nobody listened to, or counts them lost.
  it("leave out the edges of a second nobody listened to", async () => {
    const agent = await startAgent();
    const ring = edgeRing();
    const times = { at: 1, ms: 0.5 };

    agent.mock.setEdgeTimes(ring);
    agent.frame({ at: 0 });

    for (let edge = 0; edge < 3; edge += 1) pushEdge(ring, "a", "next", "b", times);

    agent.frame({ at: 500 });
    agent.frame({ at: 1000 });

    const lines = agent.listen();

    pushEdge(ring, "b", "next", "a", times);
    agent.frame({ at: 1500 });
    agent.frame({ at: 2000 });

    expect(linesOf(lines, "edge").map(line => line.node)).toEqual(["b"]);
    expect(linesOf(lines, "sample")[0]?.edges).toMatchObject({ count: 1, lost: 0 });
  });

  // Bug caught: a spike that carries the edges of another frame, or none of its own.
  it("give a spike the edges of its frame", async () => {
    const agent = await startAgent({ config: { monitor: { budgetMs: 16.7, frames: 64 } } });
    const lines = agent.listen();
    const ring = edgeRing();

    agent.mock.setEdgeTimes(ring);
    agent.frame({ at: 0 });
    pushEdge(ring, "mergeBoard/awaitIntent", "drop", "mergeBoard/drop", {
      at: 4,
      ms: 12,
      commitMs: 2,
      hooksMs: 9,
      bodyMs: 0.5,
      wallMs: 300
    });
    agent.frame({ at: 8, workMs: 30 });

    const frame = frameAt(agent.mock.api.monitor.frames(), 0)?.frame;

    pushEdge(ring, "mergeBoard/drop", "merged", "mergeBoard/awaitIntent", { at: 10, ms: 1 });
    agent.frame({ at: 16 });
    agent.mock.modules.monitor.flush();

    expect(linesOf(lines, "spike")[0]?.edges).toEqual([
      {
        frame,
        node: "mergeBoard/awaitIntent",
        outcome: "drop",
        next: "mergeBoard/drop",
        ms: 12,
        commitMs: 2,
        hooksMs: 9,
        bodyMs: 0.5,
        wallMs: 300
      }
    ]);
  });

  // Bug caught: a page whose flow does not time edges claims a second and a spike without an edge (0, []) instead of
  // "not measured".
  it("are null in the sample and the spike where the flow does not time them", async () => {
    const agent = await startAgent({ config: { monitor: { budgetMs: 16.7, frames: 64 } } });
    const lines = agent.listen();

    agent.frame({ at: 0, workMs: 30 });
    agent.frame({ at: 1000 });

    expect(linesOf(lines, "sample")[0]?.edges).toBeNull();
    expect(linesOf(lines, "spike")[0]?.edges).toBeNull();
    expect(linesOf(lines, "edge")).toEqual([]);
  });
});
