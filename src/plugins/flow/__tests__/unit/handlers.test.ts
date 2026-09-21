import { describe, expect, it } from "vitest";
import { createHandlers } from "../../handlers";
import { changed, createMockKernel } from "./mock-kernel";

// ---------------------------------------------------------------------------
// Unit test: createHandlers (the `lifecycle:changed` hook)
// ---------------------------------------------------------------------------

type Built = ReturnType<typeof createMockKernel> & {
  onChanged: ReturnType<typeof createHandlers>["lifecycle:changed"];
};

function build(): Built {
  const kernel = createMockKernel();

  return { ...kernel, onChanged: createHandlers(kernel.ctx)["lifecycle:changed"] };
}

describe("createHandlers", () => {
  it("declares exactly the one hook flow listens to", () => {
    const { ctx } = createMockKernel();

    expect(Object.keys(createHandlers(ctx))).toEqual(["lifecycle:changed"]);
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
      expect(ctx.state.runner.flushing).toBe(record.flushResult);
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
});
