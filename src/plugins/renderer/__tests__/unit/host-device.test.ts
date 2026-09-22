import { afterEach, describe, expect, it, vi } from "vitest";
import { Layer } from "../../../world/ecs/define";
import { Display, Sprite, Transform } from "../../components";
import { FakeContainer } from "../fake-pixi";
import { createMockRenderer, type MockRenderer } from "../mock-renderer";

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

const owner = { kind: "plugin", name: "test" } as const;

async function drawing(): Promise<MockRenderer> {
  const mock = createMockRenderer();

  await mock.start();
  mock.world.projection.setLayers([{ name: "items", sort: "none" }]);
  mock.modules.sync.pass();

  return mock;
}

describe("host device loss", () => {
  it("keeps the display object the game owns alive across a restore", async () => {
    const mock = await drawing();
    const object = new FakeContainer();

    mock.world.ecs.spawn(owner, [Layer({ name: "items" }), Transform(), Display({ object })]);
    mock.modules.sync.pass();

    const first = mock.pixi.last();

    first.lose("unknown");
    await tick();

    expect(first.destroyed).toBe(true);
    expect(object.destroyed).toBe(false);
    expect(object.parent).not.toBeNull();
  });

  it("destroys the pooled objects of the application it lost", async () => {
    const mock = await drawing();
    const entity = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform(),
      Sprite({ texture: "board.cell" })
    ]);

    mock.modules.sync.pass();
    mock.world.ecs.despawn(entity);
    mock.modules.sync.pass();

    const pooled = [...mock.ctx.state.sync.pools.values()].flat();

    expect(pooled).toHaveLength(1);

    mock.pixi.last().lose("unknown");
    await tick();

    expect(pooled[0]?.destroyed).toBe(true);
    expect(mock.ctx.state.sync.pooled).toBe(0);
    expect(mock.ctx.state.sync.pools.size).toBe(0);
  });

  it("measures the new canvas before it draws on it", async () => {
    const mock = createMockRenderer();

    await mock.start();

    const first = mock.pixi.last();

    first.lose("unknown");
    await tick();

    const second = mock.pixi.last();

    expect(second).not.toBe(first);
    expect(second.renderer.resizes).toHaveLength(0);

    mock.runPhase("render");

    expect(second.renderer.resizes).toEqual([{ width: 1080, height: 1920 }]);
  });

  it("reports a device promise that rejected instead of resolving", async () => {
    const mock = createMockRenderer();

    await mock.start();
    mock.pixi.last().fail(new Error("no info"));
    await tick();

    expect(mock.log.error).toHaveBeenCalledWith(
      "renderer: restore failed",
      expect.objectContaining({ error: expect.any(Error) })
    );
    expect(mock.emitted).toHaveLength(0);
  });

  it("gives the restore up when the mount is gone", async () => {
    const mock = createMockRenderer();

    await mock.start();
    mock.ctx.state.host.mount = undefined;
    mock.pixi.last().lose("unknown");
    await tick();

    expect(mock.api.host.ready()).toBe(false);
    expect(mock.pixi.applications).toHaveLength(1);
    expect(mock.pauses).toEqual([{ action: "push", reason: "device-lost" }]);
  });

  it("ignores a loss that arrives after the application was replaced", async () => {
    const mock = createMockRenderer();

    await mock.start();

    const app = mock.pixi.last();

    mock.ctx.state.host.app = undefined;
    app.lose("unknown");
    await tick();

    expect(mock.emitted).toHaveLength(0);
    expect(mock.pauses).toHaveLength(0);
  });

  it("stops listening to the canvas when the plugin stopped", async () => {
    const mock = createMockRenderer({ kind: "webgl" });

    await mock.start();

    const canvas = mock.pixi.last().canvas;

    mock.stop();
    canvas.dispatch("webglcontextlost");
    canvas.dispatch("webglcontextrestored");

    expect(mock.emitted).toHaveLength(0);
    expect(mock.pauses).toHaveLength(0);
  });

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
