import { afterEach, describe, expect, it, vi } from "vitest";
import { createMockRenderer } from "../mock-renderer";

// ---------------------------------------------------------------------------
// Unit test: host.gl() — the WebGL2 context of the live WebGL application,
// read at call time; undefined while inert, before ready, on WebGPU, while the
// context is lost and on the unsupported screen
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Yields the microtask queue, so a promise chain inside the renderer can finish. */
async function tick(): Promise<void> {
  for (let index = 0; index < 20; index += 1) await Promise.resolve();
}

describe("host.gl()", () => {
  it("answers the context of the live WebGL application", async () => {
    const mock = createMockRenderer({ kind: "webgl" });

    expect(mock.api.host.gl()).toBeUndefined();

    await mock.start();

    expect(mock.api.host.kind()).toBe("webgl");
    expect(mock.api.host.gl()).toBeDefined();
    expect(mock.api.host.gl()).toBe(mock.pixi.last().renderer.gl);
  });

  it("answers undefined on WebGPU, where the device answers instead", async () => {
    const mock = createMockRenderer({ kind: "webgpu" });

    await mock.start();

    expect(mock.api.host.ready()).toBe(true);
    expect(mock.api.host.gl()).toBeUndefined();
    expect(mock.api.host.device()).toBeDefined();
  });

  it("answers undefined while inert and on the unsupported-device screen", async () => {
    const inert = createMockRenderer({ dom: false, kind: "webgl" });

    await inert.start();

    expect(inert.api.host.gl()).toBeUndefined();

    const unsupported = createMockRenderer({ kind: "webgl", failInit: true });

    await unsupported.start();

    expect(unsupported.api.host.gl()).toBeUndefined();
  });

  it("answers undefined while the context is lost, and the context again once restored", async () => {
    const mock = createMockRenderer({ kind: "webgl" });

    await mock.start();

    const canvas = mock.pixi.last().canvas;
    const live = mock.api.host.gl();

    canvas.dispatch("webglcontextlost", { preventDefault: () => undefined });
    await tick();

    expect(mock.api.host.gl()).toBeUndefined();

    canvas.dispatch("webglcontextrestored");
    await tick();

    expect(mock.api.host.gl()).toBe(live);
  });
});
