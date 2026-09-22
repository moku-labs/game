import { describe, expect, it, vi } from "vitest";
import type { Modules, RunnerApi } from "../../runner/types";
import type { FlowCtx } from "../../types";
import { createMockKernel } from "./mock-kernel";

// ---------------------------------------------------------------------------
// Unit test: createFlowApi (module composition; the runner itself is stubbed)
// ---------------------------------------------------------------------------

const runner = vi.hoisted(() => {
  const methods = {
    run: vi.fn(),
    register: vi.fn(),
    onEnter: vi.fn(),
    walk: vi.fn(),
    bookmark: vi.fn(),
    restore: vi.fn(),
    describe: vi.fn(),
    state: vi.fn(),
    history: vi.fn(),
    setMode: vi.fn()
  };
  const seen: Array<{ ctx: FlowCtx; modules: Modules }> = [];

  return { methods, seen };
});

vi.mock("../../runner/api", () => ({
  createRunnerApi: (ctx: FlowCtx, modules: Modules): RunnerApi => {
    runner.seen.push({ ctx, modules });

    // The stub stands in for the parallel-built runner: only identity is asserted.
    return runner.methods as unknown as RunnerApi;
  }
}));

const { createFlowApi } = await import("../../api");

type Built = ReturnType<typeof createMockKernel> & { flow: ReturnType<typeof createFlowApi> };

function build(): Built {
  runner.seen.length = 0;

  const kernel = createMockKernel();

  return { ...kernel, flow: createFlowApi(kernel.ctx) };
}

function takeModules(): Modules {
  const passed = runner.seen[0];

  if (passed === undefined) throw new Error("createRunnerApi was never called");

  return passed.modules;
}

describe("createFlowApi", () => {
  describe("composition", () => {
    it("resolves time, model and clock through ctx.require", () => {
      const { record } = build();

      expect(record.requires.toSorted()).toEqual(["clock", "model", "time"]);
    });

    it("hands the runner a context that carries the resolved deps", () => {
      const { clock, time, model } = build();

      expect(runner.seen[0]?.ctx.deps).toEqual({ time, model, clock });
    });

    it("hands the runner a context that shares the plugin state", () => {
      const { ctx } = build();

      expect(runner.seen[0]?.ctx.state).toBe(ctx.state);
    });

    it("hands the runner the four sibling modules", () => {
      build();

      expect(Object.keys(takeModules()).toSorted()).toEqual(["features", "fx", "gate", "inbox"]);
    });

    it("spreads the runner methods onto the plugin root", () => {
      const { flow } = build();

      expect(flow.run).toBe(runner.methods.run);
      expect(flow.walk).toBe(runner.methods.walk);
      expect(flow.setMode).toBe(runner.methods.setMode);
    });

    it("groups the other four modules", () => {
      const { flow } = build();

      expect(Object.keys(flow)).toContain("gate");
      expect(typeof flow.inbox.post).toBe("function");
      expect(typeof flow.fx.handle).toBe("function");
      expect(typeof flow.features.register).toBe("function");
    });
  });

  describe("public surface", () => {
    it("exposes only the public gate methods", () => {
      const { flow } = build();

      expect(Object.keys(flow.gate).toSorted()).toEqual(["answer", "pointer", "state"]);
    });

    it("exposes only the public inbox method", () => {
      const { flow } = build();

      expect(Object.keys(flow.inbox)).toEqual(["post"]);
    });

    it("exposes only the public fx methods", () => {
      const { flow } = build();

      expect(Object.keys(flow.fx).toSorted()).toEqual(["dispatch", "handle", "onHint"]);
    });

    it("exposes only the public features methods", () => {
      const { flow } = build();

      expect(Object.keys(flow.features).toSorted()).toEqual(["all", "contributions", "register"]);
    });
  });

  describe("shared state", () => {
    it("writes the pointer of the public gate into the plugin state", () => {
      const { flow, ctx } = build();

      flow.gate.pointer(true);

      expect(ctx.state.gate.pointerActive).toBe(true);
    });

    it("queues a posted event in the plugin state", () => {
      const { flow, ctx } = build();

      flow.inbox.post({ type: "elapsed", payload: { now: 7 } });

      expect(ctx.state.inbox.queue).toEqual([{ type: "elapsed", payload: { now: 7 } }]);
    });

    it("registers an effect handler in the plugin state", () => {
      const { flow, ctx } = build();

      flow.fx.handle("sfx", vi.fn());

      expect(ctx.state.fx.handlers.has("sfx")).toBe(true);
    });

    it("registers a feature in the plugin state", () => {
      const { flow, ctx } = build();

      flow.features.register("board", { flows: [] });

      expect(ctx.state.features.byName.has("board")).toBe(true);
    });
  });

  describe("injection", () => {
    it("gives fx the gate the public API answers through", async () => {
      const { flow } = build();
      const controller = new AbortController();
      const answered = takeModules().fx.run(
        { kind: "popup", answers: ["again"] },
        controller.signal
      );

      expect(flow.gate.state()).toEqual({ open: true, allowed: ["again"], narrowed: false });
      expect(flow.gate.answer({ intent: "again" })).toBe(true);
      await expect(answered).resolves.toEqual({ intent: "again" });
    });
  });
});
