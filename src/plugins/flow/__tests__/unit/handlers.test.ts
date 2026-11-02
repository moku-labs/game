import { describe, expect, it } from "vitest";
import { createHandlers } from "../../handlers";
import { changed, createMockKernel } from "./mock-kernel";

// ---------------------------------------------------------------------------
// Unit test: createHandlers (the `lifecycle:changed` hook)
// ---------------------------------------------------------------------------

type Built = ReturnType<typeof createMockKernel> & {
  onChanged: ReturnType<typeof createHandlers>["lifecycle:changed"];
};

/**
 * Builds the `model:committed` hook with a node guide standing and the gate open, counting the
 * derives.
 *
 * @returns The hook, the context and how often the guide was derived.
 */
function standing() {
  const kernel = createMockKernel();
  const derived = { count: 0 };

  kernel.ctx.state.runner.guide = {
    last: undefined,
    refresh: () => {
      derived.count += 1;
    },
    reshow: () => undefined
  };
  kernel.ctx.state.gate.open = { allowed: ["merge"] };

  return { ...kernel, derived, onCommitted: createHandlers(kernel.ctx)["model:committed"] };
}

function build(): Built {
  const kernel = createMockKernel();

  return { ...kernel, onChanged: createHandlers(kernel.ctx)["lifecycle:changed"] };
}

describe("createHandlers", () => {
  it("declares exactly the hooks flow listens to", () => {
    const { ctx } = createMockKernel();

    // F98: `model:committed` derives the guide of the node that waits at its gate again.
    expect(Object.keys(createHandlers(ctx))).toEqual(["lifecycle:changed", "model:committed"]);
  });

  it("resolves no dependency before the hook fires", () => {
    const { ctx, record } = createMockKernel();

    createHandlers(ctx);

    // `hooks` runs before the kernel builds the plugin APIs, so `require` would return nothing.
    expect(record.requires).toEqual([]);
  });

  it("returns nothing: the handler is synchronous", () => {
    const { onChanged } = build();

    expect(onChanged(changed({ action: "pop", paused: false, resumed: true }))).toBeUndefined();
  });

  describe("resume", () => {
    it("pokes the clock when the pause stack emptied", () => {
      const { onChanged, record } = build();

      onChanged(changed({ action: "pop", paused: false, resumed: true }));

      expect(record.pokes).toBe(1);
    });

    it("leaves the clock alone while the game stays paused", () => {
      const { onChanged, record } = build();

      onChanged(changed({ action: "pop", paused: true, resumed: false }));

      expect(record.pokes).toBe(0);
    });
  });

  describe("background", () => {
    it("starts the model flush and tracks its promise in the runner state", () => {
      const { onChanged, record, ctx } = build();

      onChanged(changed({ reason: "background", action: "push" }));

      expect(record.flushes).toBe(1);
      expect(ctx.state.runner.flushing).toBeInstanceOf(Promise);
    });

    it("tracks a promise that never rejects, so a failed flush leaves nothing unhandled", async () => {
      const { onChanged, record, ctx } = build();
      const failed = Promise.reject(new Error("provider down"));

      failed.catch(() => undefined);
      record.flushResult = failed;
      onChanged(changed({ reason: "background", action: "push" }));

      await expect(ctx.state.runner.flushing).resolves.toBeUndefined();
    });

    it("does not flush for another pause reason", () => {
      const { onChanged, record, ctx } = build();

      onChanged(changed({ reason: "devtools", action: "push" }));

      expect(record.flushes).toBe(0);
      expect(ctx.state.runner.flushing).toBeUndefined();
    });

    it("does not flush when the background reason is popped", () => {
      const { onChanged, record, ctx } = build();

      onChanged(changed({ reason: "background", action: "pop", paused: false, resumed: true }));

      expect(record.flushes).toBe(0);
      expect(ctx.state.runner.flushing).toBeUndefined();
      expect(record.pokes).toBe(1);
    });
  });

  // F98. The guide of a rest node is derived again after a commit while the node waits at its
  // gate. Bug caught: the commit of the edge that leaves the node shows its guide again after the
  // loop lifted it, or a commit derives the guide of a node whose gate is shut.
  describe("model:committed", () => {
    it("derives the standing guide again after a commit that is no edge", () => {
      const { onCommitted, derived } = standing();

      onCommitted({ roots: ["session"], cause: "restore" });
      onCommitted({ roots: ["player", "session", "rng"], cause: "rollback" });

      expect(derived.count).toBe(2);
    });

    it("derives nothing for the commit of an edge", () => {
      const { onCommitted, derived } = standing();

      onCommitted({ roots: ["session"], cause: "edge" });

      expect(derived.count).toBe(0);
    });

    it("derives nothing while the gate is shut", () => {
      const { onCommitted, derived, ctx } = standing();

      ctx.state.gate.open = undefined;
      onCommitted({ roots: ["session"], cause: "restore" });

      expect(derived.count).toBe(0);
    });

    it("does nothing while no node guide stands", () => {
      const { onCommitted, ctx, record } = standing();

      ctx.state.runner.guide = undefined;

      expect(() => onCommitted({ roots: ["session"], cause: "restore" })).not.toThrow();
      expect(record.requires).toEqual([]);
    });
  });
});
