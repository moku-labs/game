import { afterEach, describe, expect, it, vi } from "vitest";
import { Layer } from "../../../world/ecs/define";
import { Display, Sprite, Transform } from "../../components";
import { FakeContainer } from "../fake-pixi";
import { createMockRenderer, type MockRenderer } from "../mock-renderer";

afterEach(() => {
  vi.unstubAllGlobals();
});

const owner = { kind: "plugin", name: "test" } as const;

/**
 * Starts a renderer with one layer and one sprite entity.
 *
 * @returns The mock and the entity it spawned.
 */
async function startWithOneSprite(): Promise<{ mock: MockRenderer; entity: number }> {
  const mock = createMockRenderer();

  await mock.start();
  mock.world.projection.setLayers([{ name: "items", sort: "none" }]);

  const entity = mock.world.ecs.spawn(owner, [
    Layer({ name: "items" }),
    Transform({ x: 0, y: 0 }),
    Sprite({ texture: "board.cell" })
  ]);

  mock.modules.sync.pass();

  return { mock, entity };
}

describe("renderer lifecycle", () => {
  it("creates the application, the root, the probe and the listeners on start", async () => {
    const { mock } = await startWithOneSprite();

    expect(mock.ctx.state.host.app).toBeDefined();
    expect(mock.ctx.state.sync.root).toBeDefined();
    expect(mock.ctx.state.viewport.probe).toBeDefined();
    expect(mock.frames.some(frame => frame.phase === "render")).toBe(true);
    expect(mock.dom?.observers).toHaveLength(1);
  });

  it("gives every remover back on stop", async () => {
    const { mock } = await startWithOneSprite();

    mock.stop();

    expect(mock.ctx.state.host.cleanups).toHaveLength(0);
    expect(mock.ctx.state.viewport.cleanups).toHaveLength(0);
    expect(mock.ctx.state.sync.cleanups).toHaveLength(0);
    expect(mock.dom?.observers[0]?.disconnected).toBe(true);
    expect(mock.dom?.documentListeners()).toBe(0);
  });

  it("destroys the application, keeps the textures and empties the tree", async () => {
    const { mock } = await startWithOneSprite();
    const app = mock.pixi.last();

    mock.stop();

    expect(app.destroyed).toBe(true);
    expect(app.destroyArgs).toEqual([{ removeView: true }, { children: true, texture: false }]);
    expect(mock.dom?.mount.children).not.toContain(app.canvas);
    expect(mock.ctx.state.host.ready).toBe(false);
    expect(mock.ctx.state.host.kind).toBe("none");
    expect(mock.ctx.state.host.app).toBeUndefined();
    expect(mock.ctx.state.sync.views.size).toBe(0);
    expect(mock.ctx.state.sync.layers.size).toBe(0);
    expect(mock.ctx.state.sync.pools.size).toBe(0);
    expect(mock.ctx.state.viewport.probe).toBeUndefined();
  });

  it("destroys what the pools hold", async () => {
    const { mock, entity } = await startWithOneSprite();

    mock.world.ecs.despawn(entity);
    mock.modules.sync.pass();

    const pooled = [...mock.ctx.state.sync.pools.values()].flat();

    expect(pooled).toHaveLength(1);
    mock.stop();
    expect(pooled[0]?.destroyed).toBe(true);
    expect(mock.ctx.state.sync.pooled).toBe(0);
  });

  it("detaches a Display object instead of destroying it", async () => {
    const mock = createMockRenderer();

    await mock.start();
    mock.world.projection.setLayers([{ name: "items", sort: "none" }]);

    const object = new FakeContainer();

    mock.world.ecs.spawn(owner, [Layer({ name: "items" }), Transform(), Display({ object })]);
    mock.modules.sync.pass();
    expect(object.parent).not.toBeNull();

    mock.stop();

    expect(object.destroyed).toBe(false);
    expect(object.parent).toBeNull();
  });

  it("removes the unsupported element on stop", async () => {
    const mock = createMockRenderer({ failInit: true });

    await mock.start();
    expect(mock.ctx.state.host.unsupported).toBeDefined();

    mock.stop();

    expect(mock.ctx.state.host.unsupported).toBeUndefined();
    expect(mock.dom?.mount.children.some(child => child.attributes.role === "alert")).toBe(false);
  });

  it("applies one pending resize per frame, before it draws", async () => {
    const { mock } = await startWithOneSprite();
    const dom = mock.dom;

    if (dom === undefined) throw new Error("the fake dom is missing");

    const before = mock.pixi.last().renderer.resizes.length;

    dom.mount.clientWidth = 1920;
    dom.mount.clientHeight = 1080;
    dom.observers[0]?.fire();
    mock.runPhase("render");

    expect(mock.pixi.last().renderer.resizes.at(-1)).toEqual({ width: 1920, height: 1080 });
    expect(mock.ctx.state.viewport.frame).toEqual({ x: 555, y: 0, width: 810, height: 1080 });
    expect(mock.ctx.state.sync.root?.position.x).toBe(555);
    expect(mock.ctx.state.sync.root?.scale.x).toBe(0.75);

    const after = mock.pixi.last().renderer.resizes.length;

    mock.runPhase("render");
    expect(mock.pixi.last().renderer.resizes).toHaveLength(after);
    expect(after).toBeGreaterThan(before);
  });

  it("stops cleanly when it never started", () => {
    const mock = createMockRenderer({ dom: false });

    expect(() => mock.stop()).not.toThrow();
  });
});
