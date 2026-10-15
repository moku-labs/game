import * as pixi from "pixi.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Shape, Transform } from "../../components";
import { installPassCounting } from "../../monitor/draw-calls";
import { countGlPasses, type PassRenderer } from "../../monitor/passes";
import { createSinks } from "../../monitor/state";
import { COUNT } from "../../monitor/types";
import { startDrawn } from "../demand-harness";
import {
  createFakePixi,
  FakeGpuBatchAdaptor,
  FakeGpuEncoderSystem,
  fakeExtensions,
  WEBGPU_PIPES_ADAPTOR,
  WEBGPU_SYSTEM
} from "../fake-pixi";
import { createMockRenderer, type MockRenderer } from "../mock-renderer";

// ---------------------------------------------------------------------------
// F8 (spec 23 P11): the real pass counter in every build. Production swaps the
// encoder alone, WebGL counts on Pixi's public runners, `stats()` reports the
// last drawn frame's count and the most of the last second; where nothing
// counts, the estimate of the slots.
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/**
 * Runs one frame of the mock at a clock time: phase input, then render.
 *
 * @param mock - The started mock renderer.
 * @param at - Clock time of the frame start.
 */
function frame(mock: MockRenderer, at: number): void {
  mock.setNow(at);
  mock.runPhase("input");
  mock.runPhase("render");
}

describe("the pass counter of every build", () => {
  it("the production encoder counts each begun pass inside a frame only", () => {
    const fake = createFakePixi();
    const sinks = createSinks();
    const off = installPassCounting(fake.module, sinks);
    const Encoder = fakeExtensions.named(WEBGPU_SYSTEM, "encoder") as unknown as new (
      renderer: unknown
    ) => FakeGpuEncoderSystem;

    expect(Encoder).not.toBe(FakeGpuEncoderSystem);
    expect(sinks.measuring).toBe(false);

    const encoder = new Encoder({ renderTarget: { renderTarget: {} } });

    expect(sinks.measuring).toBe(true);

    encoder.beginRenderPass({ descriptor: {} });

    expect(sinks.counts[COUNT.passes]).toBe(0);

    sinks.inFrame = true;
    encoder.beginRenderPass({ descriptor: {} });
    encoder.beginRenderPass({ descriptor: {} });

    expect(sinks.counts[COUNT.passes]).toBe(2);
    expect(encoder.calls).toEqual(["begin", "begin", "begin"]);

    off();

    expect(fakeExtensions.named(WEBGPU_SYSTEM, "encoder")).toBe(FakeGpuEncoderSystem);
  });

  it("the WebGL runners count a target change, and the root pass when nothing changed", () => {
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

    sinks.inFrame = true;
    // A kept picture: bind its texture, then the stage on the canvas.
    prerender?.emit();
    change.emit({ isRoot: false, pixelWidth: 64, pixelHeight: 64 });
    renderStart?.emit();
    prerender?.emit();
    change.emit(root);
    renderStart?.emit();
    // A frame that starts on the root it ended on: no change, the root counts.
    prerender?.emit();
    renderStart?.emit();

    expect(sinks.counts[COUNT.passes]).toBe(3);
    expect(sinks.measuring).toBe(true);

    off();
    prerender?.emit();
    renderStart?.emit();

    expect(sinks.counts[COUNT.passes]).toBe(3);
  });

  it("renderPasses is the last drawn frame's count, renderPassesMax the most of the last second; a skipped frame keeps both", async () => {
    const mock = createMockRenderer({ scene: { passes: 3 }, config: { onDemand: true } });
    /** A frame drawn for a whole-frame reason, with this many passes. */
    const drawnFrame = (at: number, passes: number): void => {
      mock.pixi.settings.scene.passes = passes;
      mock.modules.demand.whole("debug");
      frame(mock, at);
    };

    await mock.start();
    drawnFrame(0, 3);

    expect(mock.api.stats().renderPasses).toBe(3);

    drawnFrame(200, 5);
    drawnFrame(400, 2);
    // Nothing changed: the frames are skipped and count nothing.
    mock.pixi.settings.scene.passes = 9;
    frame(mock, 600);
    frame(mock, 800);

    expect(mock.api.stats()).toMatchObject({ renderPasses: 2 });

    // The second closes: its most is 5.
    frame(mock, 1000);

    expect(mock.api.stats()).toMatchObject({ renderPasses: 2, renderPassesMax: 5 });
    mock.stop();
  });

  it("without a counter (stagePixi) stats report the estimate, kept pictures included", async () => {
    const drawn = await startDrawn({ onDemand: false });
    const entity = drawn.spawn(Transform({ x: 100, y: 100 }), Shape({ w: 40, h: 40 }));

    drawn.mock.api.sync.filters.set(entity, [
      { filter: new pixi.AlphaFilter(), passes: 1, cache: "local" }
    ]);
    drawn.frame();

    // Live: the frame, the view's content, its one apply.
    expect(drawn.mock.api.stats().renderPasses).toBe(3);

    drawn.frame();
    drawn.frame();

    // The take: the frame, the picture, the content of the output and its apply; the view itself costs none.
    expect(drawn.mock.api.stats().renderPasses).toBe(4);

    drawn.frame();

    expect(drawn.mock.api.stats().renderPasses).toBe(1);
    expect(drawn.mock.api.sync.renderPasses()).toBe(1);
    drawn.mock.stop();
  });

  it("production installs the encoder alone, dev and agent builds the six counting classes", async () => {
    const release = createMockRenderer();

    await release.start();

    expect(fakeExtensions.named(WEBGPU_PIPES_ADAPTOR, "batch")).toBe(FakeGpuBatchAdaptor);
    expect(fakeExtensions.named(WEBGPU_SYSTEM, "encoder")).not.toBe(FakeGpuEncoderSystem);
    expect(release.ctx.state.host.uninstallCounting).toBeUndefined();
    expect(release.ctx.state.host.uninstallPasses).toBeDefined();
    expect(release.ctx.state.monitor.sinks.measuring).toBe(true);

    release.stop();

    expect(fakeExtensions.named(WEBGPU_SYSTEM, "encoder")).toBe(FakeGpuEncoderSystem);

    vi.stubGlobal("__MOKU_GAME_AGENT__", true);

    const agent = createMockRenderer();

    await agent.start();

    expect(fakeExtensions.named(WEBGPU_PIPES_ADAPTOR, "batch")).not.toBe(FakeGpuBatchAdaptor);
    expect(agent.ctx.state.host.uninstallCounting).toBeDefined();
    expect(agent.ctx.state.host.uninstallPasses).toBeUndefined();

    agent.stop();
  });
});
