import { afterEach, describe, expect, it, vi } from "vitest";
import { createMockRenderer } from "../mock-renderer";

// ---------------------------------------------------------------------------
// Unit: the engine's own WebGPU device of an agent build (spec 11 R3, review
// F17): Pixi's features plus timestamp-query, handed to Pixi as `webgpu.gpu`,
// destroyed after the app; the startup marks around the Pixi load and init.
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Yields the microtask queue, so a restore inside the renderer can finish. */
async function tick(): Promise<void> {
  for (let index = 0; index < 20; index += 1) await Promise.resolve();
}

/** A WebGPU adapter offering `features`, and the devices it made. */
function stubGpu(features: string[], adapterOf: () => unknown = () => undefined) {
  const devices: Array<{ destroy: ReturnType<typeof vi.fn>; features: Set<string> }> = [];
  const adapter = {
    features: new Set(features),
    limits: { maxSampledTexturesPerShaderStage: 16, maxSamplersPerShaderStage: 12 },
    requestDevice: vi.fn(async () => {
      const device = { destroy: vi.fn(), features: new Set<string>() };

      devices.push(device);

      return device;
    })
  };
  const requestAdapter = vi.fn(async () => adapterOf() ?? adapter);

  vi.stubGlobal("navigator", { userAgent: "", gpu: { requestAdapter } });

  return { adapter, devices, requestAdapter };
}

describe("the timed GPU device", () => {
  it("asks for Pixi's features the adapter has, timestamp-query when offered, and Pixi's two limits", async () => {
    vi.stubGlobal("__MOKU_GAME_AGENT__", true);
    const gpu = stubGpu([
      "texture-compression-bc",
      "bgra8unorm-storage",
      "timestamp-query",
      "shader-f16"
    ]);
    const mock = createMockRenderer();

    await mock.start();

    expect(gpu.adapter.requestDevice).toHaveBeenCalledWith({
      requiredFeatures: ["texture-compression-bc", "bgra8unorm-storage", "timestamp-query"],
      requiredLimits: { maxSampledTexturesPerShaderStage: 16, maxSamplersPerShaderStage: 12 }
    });
    expect(mock.pixi.last().initOptions?.webgpu).toEqual({
      gpu: { adapter: gpu.adapter, device: gpu.devices[0] }
    });
    expect(mock.ctx.state.host.ownGpu?.device).toBe(gpu.devices[0]);
    expect(mock.modules.host.adapter()).toBe(gpu.adapter);
  });

  it("leaves timestamp-query out when the adapter does not offer it", async () => {
    vi.stubGlobal("__MOKU_GAME_AGENT__", true);
    const gpu = stubGpu(["texture-compression-astc"]);

    await createMockRenderer().start();

    expect(gpu.adapter.requestDevice).toHaveBeenCalledWith(
      expect.objectContaining({ requiredFeatures: ["texture-compression-astc"] })
    );
  });

  it("hands Pixi no device without navigator.gpu, without an adapter, or on the WebGL preference", async () => {
    vi.stubGlobal("__MOKU_GAME_AGENT__", true);
    vi.stubGlobal("navigator", { userAgent: "" });
    const bare = createMockRenderer();

    await bare.start();

    // eslint-disable-next-line unicorn/no-null -- `requestAdapter` answers null without an adapter.
    const none = stubGpu([], () => null);
    const noAdapter = createMockRenderer();

    await noAdapter.start();

    const gpu = stubGpu(["timestamp-query"]);
    const webgl = createMockRenderer({ config: { preference: "webgl" } });

    await webgl.start();

    expect(bare.pixi.last().initOptions?.webgpu).toBeUndefined();
    expect(none.requestAdapter).toHaveBeenCalled();
    expect(noAdapter.pixi.last().initOptions?.webgpu).toBeUndefined();
    expect(gpu.requestAdapter).not.toHaveBeenCalled();
    expect(webgl.pixi.last().initOptions?.webgpu).toBeUndefined();
  });

  it("logs a refused request and starts on Pixi's own path", async () => {
    vi.stubGlobal("__MOKU_GAME_AGENT__", true);
    const gpu = stubGpu(["timestamp-query"]);

    gpu.adapter.requestDevice.mockRejectedValueOnce(new Error("limits"));
    const mock = createMockRenderer();

    await mock.start();

    expect(mock.log.warn).toHaveBeenCalledWith("renderer: no timed GPU device", {
      error: new Error("limits")
    });
    expect(mock.api.host.ready()).toBe(true);
    expect(mock.pixi.last().initOptions?.webgpu).toBeUndefined();
  });

  it("destroys its device after the app, and asks a new one for the app of a restore", async () => {
    vi.stubGlobal("__MOKU_GAME_AGENT__", true);
    const gpu = stubGpu([]);
    const mock = createMockRenderer();

    await mock.start();

    const first = mock.pixi.last();

    first.lose("unknown");
    await tick();

    expect(first.destroyed).toBe(true);
    expect(gpu.devices[0]?.destroy).toHaveBeenCalledTimes(1);
    expect(gpu.devices).toHaveLength(2);

    mock.stop();

    expect(gpu.devices[1]?.destroy).toHaveBeenCalledTimes(1);
    expect(mock.ctx.state.host.ownGpu).toBeUndefined();
  });

  it("marks the Pixi load and the init on the page's timeline", async () => {
    vi.stubGlobal("__MOKU_GAME_AGENT__", true);
    stubGpu([]);
    const mark = vi.spyOn(globalThis.performance, "mark");

    await createMockRenderer().start();

    expect(mark.mock.calls.map(([name]) => name)).toEqual([
      "moku:pixi-start",
      "moku:pixi-end",
      "moku:init-start",
      "moku:init-end"
    ]);
  });
});

describe("a build without the agent flag", () => {
  it("asks for no device and writes no mark", async () => {
    const gpu = stubGpu(["timestamp-query"]);
    const mark = vi.spyOn(globalThis.performance, "mark");
    const mock = createMockRenderer();

    await mock.start();

    expect(gpu.requestAdapter).not.toHaveBeenCalled();
    expect(mark).not.toHaveBeenCalled();
    expect(mock.pixi.last().initOptions?.webgpu).toBeUndefined();
  });
});
