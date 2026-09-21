import { afterEach, describe, expect, it, vi } from "vitest";
import { coreConfig, createCore, createPlugin } from "../../src/config";
import { reportError, reportHookError, teardown } from "../../src/teardown";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("teardown registry", () => {
  it("runs the registered disposer once and forgets it", async () => {
    const global = {};
    const dispose = vi.fn();

    teardown.register(global, "time", dispose);
    await teardown.run(global, "time");
    await teardown.run(global, "time");

    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("replaces a disposer registered twice under one key", async () => {
    const global = {};
    const first = vi.fn();
    const second = vi.fn();

    teardown.register(global, "clock", first);
    teardown.register(global, "clock", second);
    await teardown.run(global, "clock");

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("does nothing for a key that was never registered", async () => {
    await expect(teardown.run({}, "missing")).resolves.toBeUndefined();
  });

  it("keeps two apps apart", async () => {
    const firstApp = {};
    const secondApp = {};
    const disposeFirst = vi.fn();
    const disposeSecond = vi.fn();

    teardown.register(firstApp, "model", disposeFirst);
    teardown.register(secondApp, "model", disposeSecond);
    await teardown.run(firstApp, "model");

    expect(disposeFirst).toHaveBeenCalledTimes(1);
    expect(disposeSecond).not.toHaveBeenCalled();
  });

  it("awaits an async disposer", async () => {
    const global = {};
    const order: string[] = [];

    teardown.register(global, "flow", async () => {
      await Promise.resolve();
      order.push("disposed");
    });
    await teardown.run(global, "flow");
    order.push("after run");

    expect(order).toEqual(["disposed", "after run"]);
  });

  it("reports a throwing disposer and does not rethrow", async () => {
    const global = {};
    const sink = vi.spyOn(console, "error").mockImplementation(() => {});
    const failure = new Error("boom");

    teardown.register(global, "time", () => {
      throw failure;
    });

    await expect(teardown.run(global, "time")).resolves.toBeUndefined();
    expect(sink).toHaveBeenCalledWith('[game] The disposer of "time" failed.', failure);
  });
});

describe("error sink", () => {
  it("prefixes the message with the package tag", () => {
    const sink = vi.spyOn(console, "error").mockImplementation(() => {});
    const failure = new Error("bad");

    reportError("Something failed.", failure);

    expect(sink).toHaveBeenCalledWith("[game] Something failed.", failure);
  });

  it("reports a hook error", () => {
    const sink = vi.spyOn(console, "error").mockImplementation(() => {});
    const failure = new Error("hook");

    reportHookError(failure);

    expect(sink).toHaveBeenCalledWith("[game] A hook failed.", failure);
  });
});

describe("kernel precondition", () => {
  it("hands the same global object to onStart and onStop of one app", async () => {
    const seen: { start?: object; stop?: object } = {};
    const probePlugin = createPlugin("probe", {
      onStart: ctx => {
        seen.start = ctx.global;
      },
      onStop: ({ global }) => {
        seen.stop = global;
      }
    });

    // A bare framework: the precondition is about the kernel, not about the engine's default plugins.
    const bare = createCore(coreConfig, { plugins: [] });
    const app = bare.createApp({ plugins: [probePlugin] });
    await app.start();
    await app.stop();

    expect(seen.start).toBeDefined();
    expect(seen.stop).toBe(seen.start);
  });
});
