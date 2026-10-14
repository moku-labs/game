/* eslint-disable unicorn/no-null -- a frame record and a log line are JSON: "not measured" is null. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { PERF_GAP_BUCKETS, PERF_LOG_VERSION, type PerfLogLine } from "../../monitor/log-types";
import { frameAt } from "../../monitor/ring";
import { COUNT, MEASURE } from "../../monitor/types";
import { linesOf, startAgent } from "../perf-harness";

// ---------------------------------------------------------------------------
// Unit: the performance log (spec 11 R11): what a listener gets and when, the
// sample of a second, a spike that waits for its GPU time, the header, events
// and marks, the freeze of every line, the gap histogram.
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the sample", () => {
  it("counts a scripted second of 120 frames, 3 drawn, with its percentiles and phases", async () => {
    const agent = await startAgent();
    const lines = agent.listen();

    for (let index = 0; index < 120; index += 1) {
      const record = {
        at: index * 8,
        gapMs: 8,
        capMs: 1000 / 120,
        workMs: (index % 10) + 1,
        skipped: index < 6 ? 1 : 0,
        phaseMs: Float32Array.of(0.5, 0.25, 0, 0, 0, 1)
      };

      if (index % 40 === 0) agent.frame(record);
      else agent.mock.measureFrame(record);
    }

    agent.mock.measureFrame({ at: 1000 });

    const sample = linesOf(lines, "sample")[0];

    expect(sample).toMatchObject({
      frames: 120,
      drawn: 3,
      ticks: 126,
      windowMs: 1000,
      workMs: { p50: 5, p90: 9, max: 10 },
      gapMs: { p50: 8, p90: 8, p99: 8 },
      gaps: { missed: 0, drawn: 0, idle: 0 },
      path: "home"
    });
    expect(sample?.phasesMs.input).toEqual({ mean: 0.5, max: 0.5 });
    expect(sample?.phasesMs.render).toEqual({ mean: 1, max: 1 });
    expect(sample?.frameHist).toHaveLength(PERF_GAP_BUCKETS);
    expect(sample?.frameHist.reduce((sum, count) => sum + count, 0)).toBe(120);
    expect(sample?.frameHist[8]).toBe(120);
  });

  it("puts gaps of 0.5, 49.5, 52 and 250 ms in buckets 0, 49, 50 and 80 and spreads them", async () => {
    const agent = await startAgent();
    const lines = agent.listen();

    for (const [index, gapMs] of [0.5, 49.5, 52, 250].entries()) {
      agent.mock.measureFrame({ at: index * 10, gapMs });
    }

    agent.mock.measureFrame({ at: 1000 });

    const sample = linesOf(lines, "sample")[0];
    const hist = sample?.frameHist ?? [];

    expect([hist[0], hist[49], hist[50], hist[80]]).toEqual([1, 1, 1, 1]);
    expect(sample?.gapMs).toEqual({ p50: 49.5, p90: 250, p99: 250 });
    expect(sample?.gaps.missed).toBe(3);
  });

  it("is not built while nobody listens: the ring records anyway", async () => {
    const agent = await startAgent();
    const texture = agent.mock.pixi.last().renderer.texture;
    const reads = vi.fn(() => []);

    Object.defineProperty(texture, "managedTextures", { get: reads });

    agent.frame({ at: 0 });
    agent.frame({ at: 1000 });
    agent.frame({ at: 2000 });

    expect(reads).not.toHaveBeenCalled();
    expect(agent.mock.api.monitor.frames().size).toBe(3);
  });
});

describe("spikes", () => {
  it("wait one flush for a GPU time still to come, then carry their frame, passes and long frames", async () => {
    const agent = await startAgent({ scene: { passes: 2 } });
    const { columns } = agent.pc.perf.ring;
    const record = agent.pc.perf.longFrames.records[0];
    const lines = agent.listen();

    agent.pc.perf.timer = {
      kind: "timestamp-query",
      commit: slot => {
        columns.gpuPartial[slot] = 1;
      },
      close: () => undefined,
      stop: () => undefined
    };

    if (record === undefined) throw new Error("no record");

    Object.assign(record, { startMs: 40, durationMs: 70, blockingMs: 20, scriptCount: 0 });
    agent.pc.perf.longFrames.size = 1;
    agent.pc.perf.longFrames.next = 1;

    agent.frame({ at: 100, workMs: 30 });
    agent.frame({ at: 1100 });

    expect(linesOf(lines, "sample")).toHaveLength(1);
    expect(linesOf(lines, "spike")).toHaveLength(0);

    agent.frame({ at: 2100 });

    const spike = linesOf(lines, "spike")[0];

    expect(spike?.frame).toMatchObject({ frame: 1, workMs: 30, gpuPartial: true });
    expect(spike?.frame.causes).toEqual(["js", "longFrame"]);
    expect(spike?.passes).toEqual([
      { index: 0, kind: "canvas", label: null, stencil: false, w: 1080, h: 1920, gpuMs: null },
      { index: 1, kind: "canvas", label: null, stencil: false, w: 1080, h: 1920, gpuMs: null }
    ]);
    expect(spike?.longFrames).toEqual([
      {
        startMs: 40,
        durationMs: 70,
        blockingMs: 20,
        renderStartMs: null,
        styleLayoutMs: null,
        scripts: []
      }
    ]);
    expect(spike?.t).toBe(Math.round((performance.timeOrigin + 100) * 100) / 100);
  });
});

describe("the header and the delivery", () => {
  it("comes first, with the build id and the engine fingerprint of the page", async () => {
    vi.stubGlobal("__MOKU_GAME_BUILD__", "debug-20261014T153012Z");
    vi.stubGlobal("__MOKU_GAME_ENGINE__", "0.14.13+9c41e0");
    const agent = await startAgent();
    const lines = agent.listen();

    agent.mock.api.monitor.mark("shop open");

    expect(lines[0]).toMatchObject({
      v: PERF_LOG_VERSION,
      kind: "header",
      build: "debug-20261014T153012Z",
      engine: "0.14.13+9c41e0",
      timeOrigin: performance.timeOrigin,
      gpu: { backend: "webgpu", timer: null },
      measured: ["passes", "stencilPasses", "draws", "filters", "uploads", "marks"]
    });
    expect(lines[1]).toMatchObject({
      kind: "mark",
      label: "shop open",
      auto: false,
      build: "debug-20261014T153012Z"
    });
  });

  it("warns once about a throwing listener and still hands it the next line", async () => {
    const agent = await startAgent();
    const seen: string[] = [];

    agent.mock.api.monitor.stream(line => {
      seen.push(line.kind);
      throw new Error("listener boom");
    });
    agent.mock.api.monitor.mark("a");
    agent.mock.api.monitor.mark("b");

    expect(seen).toEqual(["header", "mark", "mark"]);
    expect(agent.mock.log.warn).toHaveBeenCalledTimes(1);
    expect(agent.mock.log.warn).toHaveBeenCalledWith("renderer: a monitor listener failed", {
      error: new Error("listener boom")
    });
  });

  it("hands out fresh lines, frozen all the way down, that a later flush leaves as they were", async () => {
    const agent = await startAgent();
    const lines = agent.listen();

    agent.frame({ at: 0, workMs: 2 });
    agent.frame({ at: 1000, workMs: 4 });

    const sample = linesOf(lines, "sample")[0];
    const copy = structuredClone(sample);

    agent.frame({ at: 2000, workMs: 9 });

    expect(Object.isFrozen(sample)).toBe(true);
    expect(Object.isFrozen(sample?.workMs)).toBe(true);
    expect(Object.isFrozen(sample?.frameHist)).toBe(true);
    expect(Object.isFrozen(lines[0])).toBe(true);
    expect(sample).toEqual(copy);
    expect(linesOf(lines, "sample")[1]).not.toBe(sample);
  });

  it("stops handing out lines after the unsubscribe", async () => {
    const agent = await startAgent();
    const lines: PerfLogLine[] = [];
    const off = agent.mock.api.monitor.stream(line => lines.push(line));

    off();
    off();
    agent.mock.api.monitor.mark("after");

    expect(lines.map(line => line.kind)).toEqual(["header"]);
  });
});

describe("events and marks", () => {
  it("writes the compiles and uploads of the frames after the first drawn one at the flush", async () => {
    const agent = await startAgent();
    const { pc } = agent;
    const lines = agent.listen();
    let frame = 0;

    pc.perf.measuring |= MEASURE.compiles;
    agent.mock.frames.push({
      phase: "render",
      callback: () => {
        frame += 1;
        pc.sinks.counts[COUNT.compiles] = frame === 2 ? 3 : 0;
        pc.sinks.counts[COUNT.uploadBytes] = frame === 2 ? 1.5 * 1024 * 1024 : 0;
        pc.sinks.counts[COUNT.uploads] = frame === 2 ? 2 : 0;
      }
    });
    agent.frame({ at: 0, workMs: 1 });
    agent.frame({ at: 10, workMs: 1 });
    agent.frame({ at: 1000 });

    expect(linesOf(lines, "event").map(line => [line.name, line.frame, line.detail])).toEqual([
      ["compile", 2, { frame: 2, count: 3 }],
      ["upload", 2, { frame: 2, mb: 1.5 }]
    ]);
  });

  it("marks the frame of a scene event with its subject and writes the event with that frame", async () => {
    const agent = await startAgent();
    const lines = agent.listen();

    agent.mock.frames.push({
      phase: "render",
      callback: () => agent.mock.api.monitor.event("scene", { from: "home", to: "board" })
    });
    agent.frame({ at: 0 });

    expect(frameAt(agent.mock.api.monitor.frames(), 0)?.changed).toEqual([
      { kind: "scene", what: "board" }
    ]);
    expect(linesOf(lines, "event")[0]).toMatchObject({ name: "scene", frame: 1 });

    agent.mock.api.monitor.event("command", { id: "game.filter", input: { kind: "glow" } });
    agent.mock.api.monitor.event("recorder", { action: "start" });
    agent.mock.api.monitor.event("devtools");

    expect(linesOf(lines, "event").slice(1)).toMatchObject([
      { name: "command", frame: null, detail: { id: "game.filter", input: { kind: "glow" } } },
      { name: "recorder", detail: { action: "start" } },
      { name: "devtools", detail: {} }
    ]);
  });

  it("writes an auto mark when the flow rests on a new path, and none on the same path", async () => {
    const agent = await startAgent();
    const lines = agent.listen();

    agent.mock.hooks["flow:rest"]({ path: "board/awaitIntent", checkpoint: false });
    agent.mock.hooks["flow:rest"]({ path: "board/awaitIntent", checkpoint: false });
    agent.mock.hooks["flow:rest"]({ path: "shop", checkpoint: true });

    expect(linesOf(lines, "mark").map(mark => [mark.label, mark.auto])).toEqual([
      ["board/awaitIntent", true],
      ["shop", true]
    ]);
  });

  it("carries the version every reader compares on every line", async () => {
    const agent = await startAgent();
    const lines = agent.listen();

    agent.frame({ at: 0, workMs: 30 });
    agent.mock.api.monitor.mark("m");
    agent.mock.hooks["time:thermal"]({ status: 1, headroom: null, at: null, android: null });
    agent.frame({ at: 1000 });

    expect(new Set(lines.map(line => line.kind))).toEqual(
      new Set(["header", "startup", "sample", "spike", "mark", "thermal"])
    );
    expect(lines.every(line => line.v === PERF_LOG_VERSION)).toBe(true);
  });

  it("writes the pause with its reasons and flushes the partial second, and the resume", async () => {
    const agent = await startAgent();
    const lines = agent.listen();

    agent.frame({ at: 0 });
    agent.clock.now = 400;
    agent.mock.hooks["lifecycle:changed"]({
      reason: "background",
      action: "push",
      reasons: ["background"],
      paused: true,
      resumed: false
    });
    agent.mock.hooks["lifecycle:changed"]({
      reason: "background",
      action: "pop",
      reasons: [],
      paused: false,
      resumed: true
    });

    expect(lines.map(line => line.kind)).toEqual(["header", "event", "startup", "sample", "event"]);
    expect(linesOf(lines, "event").map(line => [line.name, line.detail])).toEqual([
      ["pause", { reasons: ["background"] }],
      ["resume", { reasons: [] }]
    ]);
    expect(linesOf(lines, "sample")[0]).toMatchObject({ frames: 1, windowMs: 400 });
  });
});
