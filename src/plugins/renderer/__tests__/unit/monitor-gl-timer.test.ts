/* eslint-disable unicorn/no-null -- a frame record and a log line are JSON: "not measured" is null. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGlTimer } from "../../monitor/gl-timer";
import { frameAt } from "../../monitor/ring";
import type { FrameTimer } from "../../monitor/types";
import { createFakeGlContext, FakeRunner } from "../fake-pixi";
import { type AgentRenderer, startAgent } from "../perf-harness";

// ---------------------------------------------------------------------------
// Unit: GPU time on WebGL (spec 11 R7): one TIME_ELAPSED query per render call
// from a pool of 24, polled in order at every commit, dropped on a disjoint GPU.
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** The extension of a browser with timer queries. */
const EXTENSION = { TIME_ELAPSED_EXT: 0x88_bf, GPU_DISJOINT_EXT: 0x8f_bb };

/** A timed agent build: a fake context with the extension, Pixi's two runners, the timer. */
async function timed(): Promise<{
  agent: AgentRenderer;
  gl: ReturnType<typeof createFakeGlContext>;
  runners: { prerender: FakeRunner; postrender: FakeRunner };
  timer: FrameTimer;
}> {
  const agent = await startAgent({ config: { monitor: { budgetMs: 16.7, frames: 64 } } });
  const gl = createFakeGlContext();
  const runners = {
    prerender: new FakeRunner("prerender"),
    postrender: new FakeRunner("postrender")
  };

  gl.extensions.EXT_disjoint_timer_query_webgl2 = EXTENSION;

  const timer = createGlTimer(gl as unknown as WebGL2RenderingContext, { runners }, agent.pc);

  if (timer === undefined) throw new Error("no timer");

  agent.pc.perf.timer = timer;

  return { agent, gl, runners, timer };
}

/** One frame with one render call: the query begins and ends on the runners, then the commit. */
function renderCall(setup: Awaited<ReturnType<typeof timed>>): void {
  const { agent, runners } = setup;

  agent.pc.sinks.inFrame = true;
  runners.prerender.emit();
  runners.postrender.emit();
  agent.mock.measureFrame({ frame: agent.pc.perf.frame, workMs: 1 });
}

describe("the WebGL timer", () => {
  it("is not made without the extension: the frames keep no GPU time", async () => {
    const agent = await startAgent({ kind: "webgl" });

    agent.frame({ workMs: 1 });

    expect(frameAt(agent.mock.api.monitor.frames(), 0)?.gpuMs).toBeNull();
    expect(agent.pc.perf.timer).toBeUndefined();
    expect(
      createGlTimer(
        createFakeGlContext() as unknown as WebGL2RenderingContext,
        {
          runners: {
            prerender: new FakeRunner("prerender"),
            postrender: new FakeRunner("postrender")
          }
        },
        agent.pc
      )
    ).toBeUndefined();
  });

  it("adds an available result to the frame its query timed and clears the flag", async () => {
    const setup = await timed();
    const ring = setup.agent.mock.api.monitor.frames();

    renderCall(setup);

    expect(frameAt(ring, 0)).toMatchObject({ gpuMs: null, gpuPartial: true });

    setup.gl.getQueryParameter = (_query, name) =>
      name === setup.gl.QUERY_RESULT_AVAILABLE ? true : 4_000_000;
    renderCall(setup);

    expect(frameAt(ring, 1)).toMatchObject({ gpuMs: 4, gpuPartial: false });
    expect(frameAt(ring, 0)).toMatchObject({ gpuMs: 4, gpuPartial: false });
    expect(setup.gl.queries).toEqual(["begin", "end", "begin", "end"]);
  });

  it("drops every pending result when the GPU was disjoint", async () => {
    const setup = await timed();
    const ring = setup.agent.mock.api.monitor.frames();

    renderCall(setup);
    setup.gl.disjoint = true;
    setup.gl.getQueryParameter = (_query, name) =>
      name === setup.gl.QUERY_RESULT_AVAILABLE ? true : 4_000_000;
    renderCall(setup);

    expect(frameAt(ring, 1)?.gpuMs).toBeNull();
    expect(frameAt(ring, 0)?.gpuMs).toBeNull();
  });

  it("leaves a frame without a free query of the pool with no time", async () => {
    const setup = await timed();
    const ring = setup.agent.mock.api.monitor.frames();

    for (let frame = 0; frame < 25; frame += 1) renderCall(setup);

    expect(setup.gl.queries.filter(call => call === "begin")).toHaveLength(24);
    expect(frameAt(ring, 0)).toMatchObject({ gpuMs: null, gpuPartial: true });
  });

  it("takes its items off the runners when it stops", async () => {
    const setup = await timed();

    setup.timer.stop();

    expect(setup.runners.prerender.items).toHaveLength(0);
    expect(setup.runners.postrender.items).toHaveLength(0);
  });
});
