import { afterEach, describe, expect, it, vi } from "vitest";
import { Layer } from "../../../world/ecs/define";
import type { AnyComponentValue, Entity } from "../../../world/types";
import { Display, NineSlice, Parent, Shape, Sprite, Transform } from "../../components";
import type { FilterSlot, PixiFilter } from "../../types";
import { FakeContainer, FakeFilter, FakeTexture } from "../fake-pixi";
import { createMockRenderer, type MockRenderer } from "../mock-renderer";

// ---------------------------------------------------------------------------
// The alpha of an entity with children. `Sprite.alpha`, `NineSlice.alpha` and
// `Shape.alpha` fade the entity's whole subtree: a disabled button fades its
// icon and its label with it, a popup fades its board. A view with a wrapper
// carries the alpha on the wrapper and draws its own visual at 1 inside it, so
// the alpha is applied once. A view without children keeps it on its object.
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.unstubAllGlobals();
});

const owner = { kind: "plugin", name: "test" } as const;
const anyEntity = (): boolean => true;

/** A renderer with one layer and a 64 x 64 texture behind every key. */
async function started(): Promise<MockRenderer> {
  const mock = createMockRenderer();

  await mock.start();
  mock.api.sync.textures.provide(() => new FakeTexture({}) as never);
  mock.world.projection.setLayers([{ name: "items", sort: "none" }]);
  mock.modules.sync.pass();

  return mock;
}

/** The fake behind a display object of the renderer. */
function fake(object: object | undefined): FakeContainer | undefined {
  return object as FakeContainer | undefined;
}

/** The alpha a display object draws with: its own times every container's above it. */
function drawnAlpha(object: object | undefined): number {
  let alpha = 1;

  for (let current = fake(object); current !== undefined; current = current.parent ?? undefined) {
    alpha *= current.alpha;
  }

  return alpha;
}

/**
 * Spawns an entity in the `items` layer with one visual, builds its view and closes the frame,
 * so the next pass sees only what the test changes.
 */
function spawnParent(mock: MockRenderer, visual: AnyComponentValue): Entity {
  const entity = mock.world.ecs.spawn(owner, [Layer({ name: "items" }), Transform(), visual]);

  mock.modules.sync.pass();
  mock.world.clearChanges();

  return entity;
}

/** Spawns a child of an entity: an icon sprite, like the gear on a round button. */
function spawnIcon(mock: MockRenderer, parent: Entity): Entity {
  const entity = mock.world.ecs.spawn(owner, [
    Transform({ x: 20, y: 20 }),
    Sprite({ texture: "ui.gear" }),
    Parent({ entity: parent })
  ]);

  mock.modules.sync.pass();

  return entity;
}

/** The display object of an entity's own visual. */
function objectOf(mock: MockRenderer, entity: Entity): FakeContainer | undefined {
  return fake(mock.ctx.state.sync.views.get(entity)?.object);
}

/** The wrapper of an entity, `undefined` while it has no children. */
function wrapperOf(mock: MockRenderer, entity: Entity): FakeContainer | undefined {
  return fake(mock.ctx.state.sync.views.get(entity)?.wrapper);
}

describe("sync alpha: an entity with children", () => {
  it.each([
    ["Shape", Shape({ w: 120, h: 120, alpha: 0.6 })],
    ["NineSlice", NineSlice({ texture: "ui.disc", width: 120, height: 120, alpha: 0.6 })],
    ["Sprite", Sprite({ texture: "ui.disc", alpha: 0.6 })]
  ])("fades the children of a %s with its alpha, and draws the parent at it once", async (_, visual) => {
    const mock = await started();
    const disc = spawnParent(mock, visual);
    const icon = spawnIcon(mock, disc);

    expect(drawnAlpha(objectOf(mock, icon))).toBeCloseTo(0.6, 6);
    expect(drawnAlpha(objectOf(mock, disc))).toBeCloseTo(0.6, 6);
    expect(wrapperOf(mock, disc)?.alpha).toBe(0.6);
    expect(objectOf(mock, disc)?.alpha).toBe(1);
  });

  it("follows an alpha change of the parent into the whole subtree", async () => {
    const mock = await started();
    const disc = spawnParent(mock, Shape({ w: 120, h: 120 }));
    const icon = spawnIcon(mock, disc);

    expect(drawnAlpha(objectOf(mock, icon))).toBe(1);

    mock.world.ecs.set(disc, Shape, { alpha: 0.6 });
    mock.modules.sync.pass();

    expect(drawnAlpha(objectOf(mock, icon))).toBeCloseTo(0.6, 6);
    expect(drawnAlpha(objectOf(mock, disc))).toBeCloseTo(0.6, 6);

    mock.world.ecs.set(disc, Shape, { alpha: 1 });
    mock.modules.sync.pass();

    expect(drawnAlpha(objectOf(mock, icon))).toBe(1);
    expect(drawnAlpha(objectOf(mock, disc))).toBe(1);
  });

  it("moves an alpha written before the first child up to the wrapper, never applying it twice", async () => {
    const mock = await started();
    const disc = spawnParent(mock, Shape({ w: 120, h: 120, alpha: 0.6 }));

    expect(objectOf(mock, disc)?.alpha).toBe(0.6);
    expect(wrapperOf(mock, disc)).toBeUndefined();

    const icon = spawnIcon(mock, disc);

    expect(drawnAlpha(objectOf(mock, disc))).toBeCloseTo(0.6, 6);
    expect(drawnAlpha(objectOf(mock, icon))).toBeCloseTo(0.6, 6);
  });

  it("fades the children under the mask of a clipping parent", async () => {
    const mock = await started();
    const panel = spawnParent(mock, Shape({ w: 300, h: 200, alpha: 0.5, clip: true }));
    const icon = spawnIcon(mock, panel);
    const view = mock.ctx.state.sync.views.get(panel);

    expect(objectOf(mock, icon)?.parent).toBe(fake(view?.clipped));
    expect(drawnAlpha(objectOf(mock, icon))).toBeCloseTo(0.5, 6);
    expect(drawnAlpha(objectOf(mock, panel))).toBeCloseTo(0.5, 6);
  });

  it("draws a nine-slice with only its debug outline in the wrapper at its alpha once", async () => {
    const mock = await started();
    const panel = spawnParent(
      mock,
      NineSlice({ texture: "ui.panel", width: 300, height: 200, alpha: 0.5, debug: true })
    );

    expect(wrapperOf(mock, panel)).toBeDefined();
    expect(drawnAlpha(objectOf(mock, panel))).toBeCloseTo(0.5, 6);
  });

  it("keeps the filters and the alpha together on the wrapper", async () => {
    const mock = await started();
    const glow = new FakeFilter();
    const slot: FilterSlot = { filter: glow as unknown as PixiFilter, passes: 1 };
    const disc = spawnParent(mock, Shape({ w: 120, h: 120, alpha: 0.6 }));

    mock.api.sync.filters.set(disc, [slot]);
    spawnIcon(mock, disc);

    expect(wrapperOf(mock, disc)?.filters).toEqual([glow]);
    expect(wrapperOf(mock, disc)?.alpha).toBe(0.6);
    expect(objectOf(mock, disc)?.filters).toBeNull();
  });

  it("hides the children of a parent at alpha 0 from the hit test", async () => {
    const mock = await started();
    const popup = spawnParent(mock, Shape({ w: 300, h: 300, alpha: 0 }));
    const icon = spawnIcon(mock, popup);
    const isIcon = (entity: Entity): boolean => entity === icon;

    expect(mock.api.sync.hitTest(20, 20, isIcon)).toBeUndefined();

    mock.world.ecs.set(popup, Shape, { alpha: 0.6 });
    mock.modules.sync.pass();

    expect(mock.api.sync.hitTest(20, 20, isIcon)).toBe(icon);
  });

  it("gives a pooled parent back at alpha 1, with its wrapper gone", async () => {
    const mock = await started();
    const disc = spawnParent(mock, Shape({ w: 120, h: 120, alpha: 0.6 }));
    const icon = spawnIcon(mock, disc);
    const object = objectOf(mock, disc);

    mock.world.ecs.despawn(icon);
    mock.world.ecs.despawn(disc);
    mock.modules.sync.pass();

    expect(object?.parent).toBeNull();
    expect(object?.alpha).toBe(1);
  });
});

describe("sync alpha: what stays as it was", () => {
  it("keeps the alpha of a view without children on its own object", async () => {
    const mock = await started();
    const sprite = spawnParent(mock, Sprite({ texture: "ui.coin", alpha: 0.4 }));
    const shape = spawnParent(mock, Shape({ w: 40, h: 40, alpha: 0.3 }));

    expect(wrapperOf(mock, sprite)).toBeUndefined();
    expect(objectOf(mock, sprite)?.alpha).toBe(0.4);
    expect(objectOf(mock, shape)?.alpha).toBe(0.3);

    mock.world.ecs.set(sprite, Sprite, { alpha: 0.8 });
    mock.modules.sync.pass();

    expect(objectOf(mock, sprite)?.alpha).toBe(0.8);
  });

  it("leaves the alpha of a Display object to the game that owns it", async () => {
    const mock = await started();
    const object = new FakeContainer();

    object.alpha = 0.5;

    const host = spawnParent(mock, Display({ object }));
    const icon = spawnIcon(mock, host);

    expect(object.alpha).toBe(0.5);
    expect(wrapperOf(mock, host)?.alpha).toBe(1);
    expect(drawnAlpha(objectOf(mock, icon))).toBe(1);
  });

  it("does not fade the parent's siblings or the layer", async () => {
    const mock = await started();
    const disc = spawnParent(mock, Shape({ w: 120, h: 120, alpha: 0.6 }));
    const other = spawnParent(mock, Shape({ w: 120, h: 120 }));

    spawnIcon(mock, disc);

    expect(drawnAlpha(objectOf(mock, other))).toBe(1);
    expect(mock.ctx.state.sync.layers.get("items")?.container?.alpha).toBe(1);
    expect(mock.api.sync.hitTest(60, 60, anyEntity)).toBeDefined();
  });
});
