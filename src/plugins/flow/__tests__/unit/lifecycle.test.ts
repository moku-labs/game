import { describe, expect, it, vi } from "vitest";
import { teardown } from "../../../../teardown";
import type { Time } from "../../../time/types";
import type { FlowCtx } from "../../types";

// ---------------------------------------------------------------------------
// Unit test: resolveDeps, connectFlow, registerFlowTeardown
// ---------------------------------------------------------------------------

const loop = vi.hoisted(() => ({ stopped: [] as FlowCtx[] }));

vi.mock("../../runner/loop", () => ({
  runLoop: vi.fn(),
  stopRunner: async (ctx: FlowCtx): Promise<void> => {
    loop.stopped.push(ctx);
  }
}));

const { connectFlow, registerFlowTeardown, resolveDeps } = await import("../../lifecycle");
const { createMockKernel } = await import("./mock-kernel");

const frameAt = (frame: number): Readonly<Time> => ({ delta: 16, elapsed: 0, scale: 1, frame });

const noPayload = { kind: "schedule", payload: {} };

const effectCtx = { signal: new AbortController().signal, mode: "live" } as const;

describe("resolveDeps", () => {
  it("resolves time, model and clock through ctx.require", () => {
    const { ctx, record, time, model, clock } = createMockKernel();

    expect(resolveDeps(ctx)).toEqual({ time, model, clock });
    expect(record.requires.toSorted()).toEqual(["clock", "model", "time"]);
  });
});

describe("connectFlow", () => {
  describe("clock", () => {
    it("posts every elapsed input into the inbox", () => {
      const { ctx, record } = createMockKernel();

      connectFlow(ctx);
      record.elapsed[0]?.({ now: 1234 });

      expect(ctx.state.inbox.queue).toEqual([{ type: "elapsed", payload: { now: 1234 } }]);
    });
  });

  describe("signals", () => {
    it("registers one callback in the signals phase", () => {
      const { ctx, record } = createMockKernel();

      connectFlow(ctx);

      expect(record.frames.map(entry => entry.phase)).toEqual(["signals"]);
    });

    it("resolves the effects that settled since the last frame", () => {
      const { ctx, record } = createMockKernel();
      const settled = vi.fn();

      connectFlow(ctx);
      ctx.state.fx.settled.push(settled);
      record.frames[0]?.callback(frameAt(2));

      expect(settled).toHaveBeenCalledTimes(1);
      expect(ctx.state.fx.settled).toEqual([]);
    });

    it("keeps an answer held in the running frame", () => {
      const { ctx, record } = createMockKernel();

      connectFlow(ctx);
      ctx.state.gate.held = { answer: { intent: "play" }, frame: 2 };
      record.frames[0]?.callback(frameAt(2));

      expect(ctx.state.gate.held).toEqual({ answer: { intent: "play" }, frame: 2 });
    });

    it("drops an answer held in an earlier frame", () => {
      const { ctx, record } = createMockKernel();

      connectFlow(ctx);
      ctx.state.gate.held = { answer: { intent: "play" }, frame: 1 };
      record.frames[0]?.callback(frameAt(2));

      expect(ctx.state.gate.held).toBeUndefined();
    });
  });

  describe("schedule", () => {
    it("registers the handler so it runs in fast mode too", () => {
      const { ctx } = createMockKernel();

      connectFlow(ctx);

      expect(ctx.state.fx.handlers.get("schedule")?.runInFast).toBe(true);
    });

    it("asks the clock for the moment of the descriptor", () => {
      const { ctx, record } = createMockKernel();

      connectFlow(ctx);
      ctx.state.fx.handlers
        .get("schedule")
        ?.run({ kind: "schedule", payload: { moment: 5000 } }, effectCtx);

      expect(record.scheduled).toEqual([5000]);
    });

    it("cancels the timer when nothing is due", () => {
      const { ctx, record } = createMockKernel();

      connectFlow(ctx);
      ctx.state.fx.handlers.get("schedule")?.run(noPayload, effectCtx);

      expect(record.scheduled).toEqual([undefined]);
    });
  });
});

describe("registerFlowTeardown", () => {
  it("does not start the loop", () => {
    const { ctx } = createMockKernel();

    registerFlowTeardown(ctx);

    expect(ctx.state.runner.running).toBeUndefined();
  });

  it("registers a disposer that stops the runner with the flow context", async () => {
    const { ctx, clock } = createMockKernel();

    loop.stopped.length = 0;
    registerFlowTeardown(ctx);
    await teardown.run(ctx.global, "flow");

    expect(loop.stopped).toHaveLength(1);
    expect(loop.stopped[0]?.state).toBe(ctx.state);
    expect(loop.stopped[0]?.deps.clock).toBe(clock);
  });
});
