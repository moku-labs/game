import { afterEach, describe, expect, it, vi } from "vitest";
import { Layer } from "../../../world/ecs/define";
import type { Entity } from "../../../world/types";
import { Display, Parent, Shape, Sprite, Transform } from "../../components";
import type { Config } from "../../types";
import { FakeContainer, type FakeGraphics, FakeTexture } from "../fake-pixi";
import { createMockRenderer, type MockRenderer } from "../mock-renderer";

afterEach(() => {
  vi.unstubAllGlobals();
});

const owner = { kind: "plugin", name: "test" } as const;

async function started(config: Partial<Config> = {}): Promise<MockRenderer> {
  const mock = createMockRenderer({ config });

  await mock.start();
  mock.api.sync.textures.provide(() => FakeTexture.WHITE as never);
  mock.world.projection.setLayers([{ name: "items", sort: "none" }]);
  mock.modules.sync.pass();

  return mock;
}

describe("sync pools", () => {
  it("gives a released object to the next entity with the same look", async () => {
    const mock = await started();
    const first = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform(),
      Sprite({ texture: "board.cell" })
    ]);

    mock.modules.sync.pass();

    const object = mock.ctx.state.sync.views.get(first)?.object;

    mock.world.ecs.despawn(first);
    mock.modules.sync.pass();
    expect(mock.ctx.state.sync.pooled).toBe(1);

    const second = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform(),
      Sprite({ texture: "board.cell" })
    ]);

    mock.modules.sync.pass();

    expect(mock.ctx.state.sync.views.get(second)?.object).toBe(object);
    expect(mock.ctx.state.sync.pooled).toBe(0);
  });

  it("keeps a different texture key in a different pool", async () => {
    const mock = await started();
    const first = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform(),
      Sprite({ texture: "a" })
    ]);

    mock.modules.sync.pass();
    mock.world.ecs.despawn(first);
    mock.modules.sync.pass();

    const second = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform(),
      Sprite({ texture: "b" })
    ]);

    mock.modules.sync.pass();

    expect(mock.ctx.state.sync.views.get(second)?.object).not.toBe(
      mock.ctx.state.sync.pools.get("Sprite:a")?.[0]
    );
    expect(mock.ctx.state.sync.pools.get("Sprite:a")).toHaveLength(1);
  });

  it("resets what it pools", async () => {
    const mock = await started();
    const entity = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform({ x: 100, rotation: 1, scale: 3 }),
      Sprite({ texture: "board.cell", alpha: 0.25, tint: 0xff_00_00 })
    ]);

    mock.modules.sync.pass();
    mock.world.ecs.despawn(entity);
    mock.modules.sync.pass();

    const pooled = mock.ctx.state.sync.pools.get("Sprite:board.cell")?.[0];

    expect(pooled?.alpha).toBe(1);
    expect(pooled?.rotation).toBe(0);
    expect(pooled?.scale.x).toBe(1);
    expect(pooled?.visible).toBe(true);
    expect(pooled?.parent).toBeNull();
  });

  it("gives an empty shape a pooled graphics with no path of the shape it drew before", async () => {
    const mock = await started();
    const drawn = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform(),
      Shape({ w: 60, h: 24, fill: 0xff_00_00 })
    ]);

    mock.modules.sync.pass();

    const object = mock.ctx.state.sync.views.get(drawn)?.object as unknown as FakeGraphics;

    expect(object.ops).not.toHaveLength(0);
    mock.world.ecs.despawn(drawn);
    mock.modules.sync.pass();

    // An empty shape draws no path (spec 26 B7): the old one would still count in its parent's bounds.
    const empty = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform(),
      Shape({ w: 74, h: 112, fillAlpha: 0 })
    ]);

    mock.modules.sync.pass();

    expect(mock.ctx.state.sync.views.get(empty)?.object).toBe(object);
    expect(object.ops).toEqual([]);
  });

  it("never resets an object the game owns", async () => {
    const mock = await started();
    const object = new FakeContainer();

    object.alpha = 0.4;
    object.visible = false;

    const entity = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform(),
      Display({ object })
    ]);

    mock.modules.sync.pass();
    mock.world.ecs.despawn(entity);
    mock.modules.sync.pass();

    expect(object.alpha).toBe(0.4);
    expect(object.visible).toBe(false);
    expect(object.parent).toBeNull();
    expect(mock.ctx.state.sync.pooled).toBe(0);
  });

  it("destroys the oldest pooled object over the limit, and keeps its texture", async () => {
    const mock = await started({ poolLimit: 1 });
    const first = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform(),
      Sprite({ texture: "a" })
    ]);
    const second = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform(),
      Sprite({ texture: "b" })
    ]);

    mock.modules.sync.pass();

    const firstObject = mock.ctx.state.sync.views.get(first)?.object;

    mock.world.ecs.despawn(first);
    mock.modules.sync.pass();
    mock.world.ecs.despawn(second);
    mock.modules.sync.pass();

    expect(mock.ctx.state.sync.pooled).toBe(1);
    expect(firstObject?.destroyed).toBe(true);
    expect(FakeTexture.WHITE.destroyed).toBe(false);
  });

  // Bug: a window that closes destroys every wrapper, and the next window builds them all again (hot path 2в).
  it("gives the wrapper of a parent that left to the next parent", async () => {
    const mock = await started();
    const first = spawnParent(mock);

    mock.modules.sync.pass();

    const wrapper = mock.ctx.state.sync.views.get(first.parent)?.wrapper;

    despawnAll(mock, first);
    mock.modules.sync.pass();

    expect(wrapper?.destroyed).toBe(false);
    expect(wrapper?.parent).toBeNull();

    const second = spawnParent(mock);

    mock.modules.sync.pass();

    const view = mock.ctx.state.sync.views.get(second.parent);

    expect(view?.wrapper).toBe(wrapper);
    expect(view?.wrapper?.label).toBe(`parent#${second.parent}`);
    expect(view?.wrapper?.children).toEqual([
      view?.object,
      mock.ctx.state.sync.views.get(second.child)?.object
    ]);
  });

  // Bug: a pooled wrapper brings the pose, the look, the hidden reason or a foreign child of its last parent.
  it("brings a pooled wrapper back with nothing of its last parent", async () => {
    const mock = await started();
    const first = spawnParent(mock, { x: 40, y: 7, rotation: 1, scale: 2 });

    mock.modules.sync.pass();

    const wrapper = mock.ctx.state.sync.views.get(first.parent)
      ?.wrapper as unknown as FakeContainer;
    const foreign = new FakeContainer();

    wrapper.addChild(foreign);
    wrapper.alpha = 0.3;
    wrapper.visible = false;
    wrapper.renderable = false;
    wrapper.zIndex = 5;
    (wrapper as unknown as { blendMode: string }).blendMode = "add";
    despawnAll(mock, first);
    mock.modules.sync.pass();

    expect(wrapper.children).toEqual([]);
    expect(foreign.parent).toBeNull();
    expect(wrapper.alpha).toBe(1);
    expect(wrapper.visible).toBe(true);
    expect(wrapper.renderable).toBe(true);
    expect(wrapper.rotation).toBe(0);
    expect(wrapper.position.x).toBe(0);
    expect(wrapper.scale.x).toBe(1);
    expect(wrapper.zIndex).toBe(0);
    expect((wrapper as unknown as { blendMode: string }).blendMode).toBe("inherit");
    expect(wrapper.label).toBe("");
  });

  // Bug: a wrapper the kept cache made the root of a render group stays one in its next life.
  it("takes the render group the kept cache made off a pooled wrapper", async () => {
    const mock = await started();
    const first = spawnParent(mock);

    mock.modules.sync.pass();

    const wrapper = mock.ctx.state.sync.views.get(first.parent)?.wrapper;
    const disable = vi.fn();

    if (wrapper === undefined) throw new Error("no wrapper");
    Object.assign(wrapper, { disableRenderGroup: disable });
    mock.ctx.state.kept.madeGroups.add(wrapper);
    despawnAll(mock, first);
    mock.modules.sync.pass();

    expect(disable).toHaveBeenCalledTimes(1);
    expect(mock.ctx.state.kept.madeGroups.has(wrapper)).toBe(false);
  });

  // Bug: a wrapper that is a render group made by another hand (a window's group) stays one, and the kept cache's
  // bookkeeping never undoes it.
  it("takes a render group nobody recorded off a pooled wrapper", async () => {
    const mock = await started();
    const first = spawnParent(mock);

    mock.modules.sync.pass();

    const wrapper = mock.ctx.state.sync.views.get(first.parent)?.wrapper;
    const disable = vi.fn(function (this: { isRenderGroup: boolean }) {
      this.isRenderGroup = false;
    });

    if (wrapper === undefined) throw new Error("no wrapper");
    Object.assign(wrapper, { isRenderGroup: true, disableRenderGroup: disable });
    despawnAll(mock, first);
    mock.modules.sync.pass();

    expect(disable).toHaveBeenCalledTimes(1);
    expect(wrapper.isRenderGroup).toBe(false);
  });

  // Bug: a mask hung on a wrapper clips the next parent that gets it.
  it("takes a mask off a pooled wrapper", async () => {
    const mock = await started();
    const first = spawnParent(mock);

    mock.modules.sync.pass();

    const wrapper = mock.ctx.state.sync.views.get(first.parent)
      ?.wrapper as unknown as FakeContainer;

    wrapper.mask = new FakeContainer();
    despawnAll(mock, first);
    mock.modules.sync.pass();

    expect(wrapper.mask).toBeNull();
  });

  // Bug: pooled wrappers grow without a bound: they count against `poolLimit` with the objects.
  it("keeps wrappers and objects within one pool limit together", async () => {
    const mock = await started({ poolLimit: 3 });
    const first = spawnParent(mock);
    const second = spawnParent(mock);

    mock.modules.sync.pass();

    const views = mock.ctx.state.sync.views;
    const released = [first, second].flatMap(pair => [
      views.get(pair.parent)?.wrapper,
      views.get(pair.parent)?.object,
      views.get(pair.child)?.object
    ]);

    despawnAll(mock, first);
    mock.modules.sync.pass();
    // Two objects and a wrapper: at the limit, nothing destroyed.
    expect(mock.ctx.state.sync.pooled).toBe(3);
    expect(released.filter(object => object?.destroyed)).toHaveLength(0);

    despawnAll(mock, second);
    mock.modules.sync.pass();

    // Six released, three kept: the other three are destroyed.
    expect(mock.ctx.state.sync.pooled).toBe(3);
    expect(released.filter(object => object?.destroyed)).toHaveLength(3);
  });

  // Bug: the wrappers waiting in the pool outlive the app.
  it("destroys the pooled wrappers on stop", async () => {
    const mock = await started();
    const first = spawnParent(mock);

    mock.modules.sync.pass();

    const wrapper = mock.ctx.state.sync.views.get(first.parent)?.wrapper;

    despawnAll(mock, first);
    mock.modules.sync.pass();
    await mock.stop();

    expect(wrapper?.destroyed).toBe(true);
  });
});

/**
 * Spawns a parent sprite with one child sprite, so the parent gets a wrapper.
 *
 * @param mock - The renderer under test.
 * @param pose - The parent's transform.
 * @returns The two entities.
 */
function spawnParent(
  mock: MockRenderer,
  pose: Parameters<typeof Transform>[0] = {}
): { parent: Entity; child: Entity } {
  const parent = mock.world.ecs.spawn(owner, [
    Layer({ name: "items" }),
    Transform(pose),
    Sprite({ texture: "board.cell" })
  ]);
  const child = mock.world.ecs.spawn(owner, [
    Transform(),
    Sprite({ texture: "board.cell" }),
    Parent({ entity: parent })
  ]);

  return { parent, child };
}

/**
 * Despawns a parent and its child in one frame, as a closing window does.
 *
 * @param mock - The renderer under test.
 * @param pair - The two entities.
 * @param pair.parent - The parent.
 * @param pair.child - The child.
 */
function despawnAll(mock: MockRenderer, pair: { parent: Entity; child: Entity }): void {
  mock.world.ecs.despawn(pair.child);
  mock.world.ecs.despawn(pair.parent);
}
