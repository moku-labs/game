import { afterEach, describe, expect, it, vi } from "vitest";
import { createMockRenderer } from "../mock-renderer";

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * Yields the microtask queue, so a promise chain inside the renderer can finish.
 *
 * @param times - How many microtasks to wait.
 */
async function tick(times = 20): Promise<void> {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
}

describe("host device loss", () => {
  it("pauses the game and emits the event when the GPU device goes", async () => {
    const mock = createMockRenderer();

    await mock.start();
    const first = mock.pixi.last();

    first.lose("unknown");
    await tick();

    expect(mock.emitted[0]).toEqual({
      name: "renderer:device-lost",
      payload: { kind: "webgpu", reason: "unknown" }
    });
    expect(mock.pauses[0]).toEqual({ action: "push", reason: "device-lost" });
  });

  it("re-initialises Pixi and rebuilds the tree after a lost WebGPU device", async () => {
    const mock = createMockRenderer();

    await mock.start();
    const first = mock.pixi.last();

    first.lose("unknown");
    await tick();

    expect(mock.pixi.applications.length).toBe(2);
    expect(first.destroyed).toBe(true);
    expect(mock.api.host.ready()).toBe(true);
    expect(mock.api.host.canvas()).toBe(mock.pixi.last().canvas);
    expect(mock.pauses.at(-1)).toEqual({ action: "pop", reason: "device-lost" });
    expect(mock.ctx.state.sync.root).toBeDefined();
  });

  it("shows the unsupported screen when the restore fails, and keeps the pause", async () => {
    const mock = createMockRenderer();

    await mock.start();
    mock.pixi.settings.failInit = true;
    mock.pixi.last().lose("unknown");
    await tick();

    expect(mock.api.host.ready()).toBe(false);
    expect(mock.api.host.kind()).toBe("none");
    expect(mock.pauses.filter(entry => entry.action === "pop")).toHaveLength(0);
    expect(mock.dom?.mount.children.some(child => child.attributes.role === "alert")).toBe(true);
  });

  it("catches a lost WebGL context on the canvas and lets Pixi restore it", async () => {
    const mock = createMockRenderer({ kind: "webgl" });

    await mock.start();

    let prevented = false;

    mock.pixi.last().canvas.dispatch("webglcontextlost", {
      preventDefault: () => {
        prevented = true;
      }
    });
    await tick();

    expect(prevented).toBe(true);
    expect(mock.api.host.ready()).toBe(false);
    expect(mock.emitted[0]).toEqual({
      name: "renderer:device-lost",
      payload: { kind: "webgl", reason: "webglcontextlost" }
    });
    expect(mock.pixi.applications).toHaveLength(1);

    mock.pixi.last().canvas.dispatch("webglcontextrestored");
    await tick();

    expect(mock.api.host.ready()).toBe(true);
    expect(mock.pauses.at(-1)).toEqual({ action: "pop", reason: "device-lost" });
  });

  it("ignores a device that goes away while the plugin stops", async () => {
    const mock = createMockRenderer();

    await mock.start();
    const app = mock.pixi.last();

    mock.stop();
    app.lose("destroyed");
    await tick();

    expect(mock.emitted).toHaveLength(0);
    expect(mock.pauses).toHaveLength(0);
    expect(mock.pixi.applications).toHaveLength(1);
  });
});
