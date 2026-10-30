import * as pixi from "pixi.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLazyCanvasClasses } from "../../host/render-pass";
import { createCountingClasses } from "../../monitor/draw-calls";
import { countGlPasses, createPassSink, type PassRenderer } from "../../monitor/passes";
import { createFrameRing, passesOf, writePass } from "../../monitor/ring";
import { createSinks } from "../../monitor/state";
import { COUNT, type PassTarget, SECTION } from "../../monitor/types";
import { CANVAS_RESTARTS, type CanvasRestart, RESTART } from "../../reasons";
import type { PixiModule } from "../../types";
import { createMockRenderer, type MockRenderer } from "../mock-renderer";
import { createPassStage, type PassStage } from "../pass-stage";
import { type AgentRenderer, startAgent } from "../perf-harness";

// ---------------------------------------------------------------------------
// F126 stage 0: every canvas pass of a frame is counted where the lazy adaptor really begins it, with the reason it
// began, through the seam `host.onCanvasPass`: the file of the adaptor never imports the monitor. Real Pixi systems
// over the recording stand-in of the GPU (pass-stage); the monitor is the real one over the fake Pixi.
// ---------------------------------------------------------------------------

/** What the installer of the host was handed last: the seam between the adaptor and the host's state. */
const installed = vi.hoisted(() => ({
  listener: undefined as ((restart: number) => void) | undefined
}));

vi.mock("../../host/render-pass", async importOriginal => {
  const actual = await importOriginal<typeof import("../../host/render-pass")>();

  return {
    ...actual,
    installLazyCanvasPass: (module: PixiModule, listener: (restart: number) => void) => {
      installed.listener = listener;

      return actual.installLazyCanvasPass(module, listener);
    }
  };
});

/** The real module, as the renderer types it. */
const module = pixi as unknown as PixiModule;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/**
 * A stage over the lazy canvas pass that keeps the reason of every canvas begin.
 *
 * @param antialias - A canvas with multisampling.
 * @returns The stage and the reasons, in order.
 */
function namedStage(antialias = false): { stage: PassStage; reasons: CanvasRestart[] } {
  const reasons: CanvasRestart[] = [];
  const classes = createLazyCanvasClasses(module, restart => {
    reasons.push(CANVAS_RESTARTS[restart] ?? "none");
  });

  return { stage: createPassStage({ ...classes, antialias }), reasons };
}

/**
 * A frame with a stencil mask around a filter.
 *
 * @param stage - The stage.
 */
function maskedFrame(stage: PassStage): void {
  stage.frame(() => {
    stage.pushMask();
    stage.withFilter(stage.draw);
    stage.popMask();
  });
}

/**
 * A frame without a mask: a draw, then a filter.
 *
 * @param stage - The stage.
 */
function plainFrame(stage: PassStage): void {
  stage.frame(() => {
    stage.draw();
    stage.withFilter(stage.draw);
  });
}

/**
 * A mask that comes into a canvas pass that discards its stencil.
 *
 * @param stage - The stage, past two frames without a mask.
 */
function lateMaskFrame(stage: PassStage): void {
  stage.frame(() => {
    stage.draw();
    stage.pushMask();
    stage.withFilter(stage.draw);
    stage.popMask();
  });
}

/**
 * Brings a stage to the rule that discards the canvas's stencil and depth: the attachment made by a mask, two frames
 * without one.
 *
 * @param stage - The stage.
 */
function discarding(stage: PassStage): void {
  maskedFrame(stage);
  plainFrame(stage);
  plainFrame(stage);
}

describe("the reason a canvas pass began", () => {
  // Bug: the frame's first begin is read as a break, or the way back from a filter as a first begin.
  it("names the first begin of a render call first and the way back from a filter filter", () => {
    const { stage, reasons } = namedStage();

    plainFrame(stage);

    expect(reasons).toEqual(["first", "filter"]);
  });

  // Bug: a frame that starts with a filter has no break at all, and must not be read as one.
  it("names first for a frame whose first draw on the canvas comes after a filter", () => {
    const { stage, reasons } = namedStage();

    stage.frame(() => stage.withFilter(stage.draw));

    expect(reasons).toEqual(["first"]);
  });

  // Bug: `first` is remembered past the end of a render call, and every later frame reads as a break.
  it("starts over at every render call", () => {
    const { stage, reasons } = namedStage();

    stage.frame(stage.draw);
    stage.frame(stage.draw);

    expect(reasons).toEqual(["first", "first"]);
  });

  // Bug: a mask's restart is blamed on a filter: the cost of masks hides among the filters' breaks.
  it("names mask for a restart for a stencil push", () => {
    const { stage, reasons } = namedStage();

    discarding(stage);
    reasons.length = 0;
    lateMaskFrame(stage);

    expect(reasons).toEqual(["first", "mask", "filter"]);
  });

  // Bug: the first depth use's restart is blamed on a filter.
  it("names depth for a restart for the first depth use", () => {
    const { stage, reasons } = namedStage();

    discarding(stage);
    reasons.length = 0;
    stage.frame(() => {
      stage.draw();
      stage.drawDepth();
    });

    expect(reasons).toEqual(["first", "depth"]);
  });

  // Bug: a pass nothing draws in reads as the frame's first pass.
  it("names empty for a frame that draws nothing and for a clear paid before a copy", () => {
    const { stage, reasons } = namedStage();

    stage.frame(() => undefined);
    stage.frame(() => {
      stage.copyCanvas();
      stage.withFilter(stage.draw);
    });

    expect(reasons).toEqual(["empty", "empty", "filter"]);
  });

  // Bug: a bind that begins nothing is counted: a filter's bind of a canvas whose pass stands open costs no pass.
  it("reports nothing for a bind that reuses the open pass", () => {
    const { stage, reasons } = namedStage();

    stage.frame(() => {
      stage.draw();
      stage.bindCanvas();
      stage.draw();
    });

    expect(reasons).toEqual(["first"]);
  });

  // Bug: one pass counted twice, once per caller path: the count must equal the passes the GPU saw on the canvas.
  it("reports one reason per canvas pass the GPU began", () => {
    const { stage, reasons } = namedStage();

    discarding(stage);
    lateMaskFrame(stage);

    expect(reasons).toHaveLength(stage.gpu.passes.filter(pass => pass.target === "canvas").length);
  });

  // Not counted here: Pixi begins this canvas itself; `stats()` then reports the estimate (see the estimate's tests).
  it("reports nothing for a canvas with multisampling, which is left to Pixi", () => {
    const { stage, reasons } = namedStage(true);

    plainFrame(stage);

    expect(reasons).toEqual([]);
  });
});

/**
 * One frame of the mock with these canvas begins inside it.
 *
 * @param mock - The started mock.
 * @param at - Clock time of the frame start.
 * @param begins - The canvas passes the frame begins.
 */
function canvasFrame(mock: MockRenderer, at: number, begins: number): void {
  mock.modules.demand.whole("debug");
  mock.setNow(at);
  mock.runPhase("input");

  for (let begin = 0; begin < begins; begin += 1) {
    mock.ctx.state.host.onCanvasPass?.(RESTART.filter);
  }

  mock.runPhase("render");
}

describe("the canvas count of the monitor", () => {
  // Bug: the host hands the adaptor nothing, or a reference to a listener of an older start: nothing reaches the monitor.
  it("reaches the monitor's listener from the adaptor through the host", async () => {
    const mock = createMockRenderer();

    await mock.start();

    mock.setNow(0);
    mock.runPhase("input");
    installed.listener?.(RESTART.first);

    expect(mock.ctx.state.monitor.sinks.counts[COUNT.canvas]).toBe(1);
    mock.stop();
  });

  // Bug: a pass of an extract or a capture between two frames counts as a break of the next frame.
  it("counts a begin inside a frame only", async () => {
    const mock = createMockRenderer();

    await mock.start();

    mock.ctx.state.host.onCanvasPass?.(RESTART.first);

    expect(mock.ctx.state.monitor.sinks.counts[COUNT.canvas]).toBe(0);

    canvasFrame(mock, 0, 2);
    mock.ctx.state.host.onCanvasPass?.(RESTART.first);

    expect(mock.api.stats().canvasPasses).toBe(2);
    mock.stop();
  });

  // Bug: the count of a frame is not started over, and a production build, which opens no ring frame, sums every frame.
  it("reports the last drawn frame, the most of the last full second, and keeps both on a skipped frame", async () => {
    const mock = createMockRenderer({ config: { onDemand: true } });

    await mock.start();
    canvasFrame(mock, 0, 3);

    expect(mock.api.stats().canvasPasses).toBe(3);

    canvasFrame(mock, 200, 5);
    canvasFrame(mock, 400, 2);

    // Nothing changed: the frames are skipped, and a begin that came anyway counts for nothing.
    for (const at of [600, 800]) {
      mock.setNow(at);
      mock.runPhase("input");
      mock.ctx.state.host.onCanvasPass?.(RESTART.filter);
      mock.runPhase("render");
    }

    expect(mock.api.stats().canvasPasses).toBe(2);

    // The second closes: its most is 5; the next second had one frame of 2.
    mock.setNow(1000);
    mock.runPhase("input");
    mock.runPhase("render");

    expect(mock.api.stats()).toMatchObject({ canvasPasses: 2, canvasPassesMax: 5 });

    canvasFrame(mock, 1500, 2);
    mock.setNow(2100);
    mock.runPhase("input");
    mock.runPhase("render");

    expect(mock.api.stats().canvasPassesMax).toBe(2);
    mock.stop();
  });

  // Bug: an agent build returns before it subscribes (it counts its passes through `attach`), or counts twice.
  it("counts once in an agent build too", async () => {
    const agent = await startAgent();

    canvasFrame(agent.mock, 0, 3);
    agent.mock.measureFrame();

    expect(agent.mock.api.stats().canvasPasses).toBe(3);
    agent.mock.stop();
  });

  // Bug: a new application of the same renderer starts with the numbers of the old, or a stopped host still calls out.
  it("forgets its window and the listener when it stops", async () => {
    const mock = createMockRenderer();

    await mock.start();
    canvasFrame(mock, 0, 3);
    mock.stop();

    expect(mock.ctx.state.monitor.canvas).toEqual({ last: 0, open: 0, max: 0 });
    expect(mock.ctx.state.host.onCanvasPass).toBeUndefined();
  });

  // Bug: the runner counts every target as the canvas: a filter's input reads as a break.
  it("counts the binds of the canvas on WebGL, and no other target", () => {
    const sinks = createSinks();
    const root = { isRoot: true, pixelWidth: 1080, pixelHeight: 1920 };
    const renderer = {
      runners: {
        prerender: new pixi.SystemRunner("prerender"),
        renderStart: new pixi.SystemRunner("renderStart")
      },
      renderTarget: {
        onRenderTargetChange: new pixi.SystemRunner("onRenderTargetChange"),
        renderTarget: root
      }
    } as unknown as PassRenderer;
    const off = countGlPasses(renderer, sinks);
    const { prerender, renderStart } = renderer.runners as unknown as Record<
      string,
      pixi.SystemRunner
    >;
    const change = renderer.renderTarget.onRenderTargetChange as unknown as pixi.SystemRunner;

    // Outside a frame nothing counts.
    prerender?.emit();
    renderStart?.emit();
    sinks.inFrame = true;
    // A frame on the root it ended on, a filter's input, back to the canvas.
    prerender?.emit();
    renderStart?.emit();
    change.emit({ isRoot: false, pixelWidth: 64, pixelHeight: 64 });
    change.emit(root);

    expect(sinks.counts[COUNT.passes]).toBe(3);
    expect(sinks.counts[COUNT.canvas]).toBe(2);
    off();
  });
});

/**
 * The agent build drawing on a stage over the lazy canvas pass, the host's listener at the adaptor as in the engine, the
 * counting encoder writing the pass ring.
 *
 * @param agent - The started agent build.
 * @returns The stage.
 */
function agentStage(agent: AgentRenderer): PassStage {
  const { sinks } = agent.pc;
  const classes = createLazyCanvasClasses(module, restart => {
    agent.mock.ctx.state.host.onCanvasPass?.(restart);
  });
  const stage = createPassStage({
    ...classes,
    encoder: createCountingClasses(module, sinks).encoder
  });

  sinks.passes = createPassSink(agent.pc, undefined, stage.canvas as unknown as PassTarget);
  sinks.inFrame = true;

  return stage;
}

describe("the restart column of the pass ring", () => {
  // Bug (verification): the ring names the wrong reason, or the reason lands on the slot of the pass before.
  it("names mask for a stencil restart and filter for the way back from a filter, none for the filter's own pass", async () => {
    const agent = await startAgent();
    const stage = agentStage(agent);

    discarding(stage);

    const { passes } = agent.mock.api.monitor.frames();
    const from = passes.written;

    lateMaskFrame(stage);

    const names = Array.from({ length: passes.written - from }, (_pass, age) => {
      return CANVAS_RESTARTS[passes.restart[(from + age) % passes.capacity] ?? 0];
    });

    expect(names).toEqual(["first", "mask", "none", "filter"]);
    agent.mock.stop();
  });

  // Bug: the spike line loses the reason, or says `"none"` on every texture pass (the key stays out of a pass with none).
  it("carries the reason on a pass of a spike line as its name, and no key for none", async () => {
    const agent = await startAgent();
    const stage = agentStage(agent);

    plainFrame(stage);

    const ring = agent.mock.api.monitor.frames();
    const found = passesOf(ring, agent.pc.perf.frame);

    expect(found.map(pass => pass.restart)).toEqual(["first", undefined, "filter"]);
    expect(found[1]).not.toHaveProperty("restart");
    agent.mock.stop();
  });

  // Bug: with the `gpu` section on and `passes` off the pass is not written, and the reason lands on an older pass.
  it("leaves the ring alone while the passes section is off", async () => {
    const agent = await startAgent();
    const stage = agentStage(agent);

    plainFrame(stage);

    const { passes } = agent.mock.api.monitor.frames();
    const before = [...passes.restart.subarray(0, passes.written)];

    agent.pc.sinks.sections &= ~SECTION.passes;
    stage.frame(stage.draw);

    expect([...passes.restart.subarray(0, passes.written)]).toEqual(before);
    agent.mock.stop();
  });

  // Bug: a slot used again keeps the reason of the canvas pass it held, on a pass that is no canvas pass.
  it("starts a recycled slot at none", () => {
    const ring = createFrameRing(1);
    const { passes } = ring;

    passes.restart[0] = RESTART.mask;

    for (let pass = 0; pass <= passes.capacity; pass += 1) {
      // eslint-disable-next-line unicorn/no-null -- a pass without a label is `null` in the ring.
      writePass(passes as never, 0, pass, 0, 0, 1, 1, null);
    }

    expect(passes.restart[0]).toBe(RESTART.none);
  });
});
