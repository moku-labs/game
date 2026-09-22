import { afterEach, describe, expect, it, vi } from "vitest";
import { createMockRenderer } from "../mock-renderer";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("host pixi module", () => {
  it("hands out the loaded module once the renderer is ready", async () => {
    const mock = createMockRenderer();

    expect(mock.api.host.pixi()).toBeUndefined();

    await mock.start();

    expect(mock.api.host.ready()).toBe(true);
    expect(mock.api.host.pixi()).toBe(mock.pixi.module);
  });

  it("hands out nothing while inert", async () => {
    const mock = createMockRenderer({ dom: false });

    await mock.start();

    expect(mock.api.host.pixi()).toBeUndefined();
  });

  it("hands out nothing on the unsupported-device screen", async () => {
    const mock = createMockRenderer({ failInit: true });

    await mock.start();

    expect(mock.api.host.ready()).toBe(false);
    expect(mock.api.host.pixi()).toBeUndefined();
  });
});
