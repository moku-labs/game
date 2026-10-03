import { afterEach, describe, expect, it, vi } from "vitest";
import { Layer, Order } from "../../../world/ecs/define";
import type { Entity } from "../../../world/types";
import { NineSlice, Parent, Shape, Transform } from "../../components";
import type { FilterSlot, PixiFilter } from "../../types";
import { type FakeContainer, FakeFilter, type FakeGraphics, FakeTexture } from "../fake-pixi";
import { createMockRenderer, type MockRenderer } from "../mock-renderer";

// ---------------------------------------------------------------------------
// `NineSlice.clip`: the rule of `Shape.clip` on a nine-slice. The children of
// the entity are masked to the `width × height` box, and the mask is never drawn.
// Only the children: the element's own visual stays outside the masked
// container, so its stroke and its corners are drawn whole (decision 39).
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.unstubAllGlobals();
});

const owner = { kind: "plugin", name: "test" } as const;
const anyEntity = (): boolean => true;

async function started(): Promise<MockRenderer> {
  const mock = createMockRenderer();

  await mock.start();
  mock.world.projection.setLayers([{ name: "items", sort: "none" }]);
  mock.modules.sync.pass();

  return mock;
}

/** The field art: insets of 24 on every side. */
function provideField(mock: MockRenderer): void {
  const field = new FakeTexture({
    source: { width: 96, height: 96, destroyed: false },
    defaultBorders: { left: 24, top: 24, right: 24, bottom: 24 }
  });

  mock.api.sync.textures.provide(key => (key === "ui.field" ? field : undefined) as never);
}

function spawnField(mock: MockRenderer, clip: boolean, debug = false): number {
  const entity = mock.world.ecs.spawn(owner, [
    Layer({ name: "items" }),
    Transform({ x: 40, y: 400 }),
    NineSlice({ texture: "ui.field", width: 480, height: 96, clip, debug })
  ]);

  mock.modules.sync.pass();

  return entity;
}

function maskOf(mock: MockRenderer, entity: number): FakeGraphics | undefined {
  return mock.ctx.state.sync.views.get(entity)?.mask as unknown as FakeGraphics | undefined;
}

/** The fake behind a display object of the renderer. */
function fake(object: object | undefined): FakeContainer | undefined {
  return object as FakeContainer | undefined;
}

/** True when the object, or anything above it, is masked. */
function underMask(object: FakeContainer | undefined): boolean {
  let current = object;

  while (current !== undefined) {
    if (current.mask !== null) return true;
    current = current.parent ?? undefined;
  }

  return false;
}

/** A child of the field: a 40 x 40 shape. */
function spawnChild(mock: MockRenderer, parent: Entity, order = 0): Entity {
  const entity = mock.world.ecs.spawn(owner, [
    Transform({ x: 20, y: 20 }),
    Shape({ w: 40, h: 40 }),
    Order({ value: order }),
    Parent({ entity: parent })
  ]);

  mock.modules.sync.pass();

  return entity;
}

/** The display object a child view hangs in the tree by. */
function objectOf(mock: MockRenderer, entity: Entity): FakeContainer | undefined {
  const view = mock.ctx.state.sync.views.get(entity);

  return fake(view?.wrapper ?? view?.object);
}

describe("sync nine-slice clip", () => {
  it("masks a children container with a filled rectangle beside it in the wrapper", async () => {
    const mock = await started();

    provideField(mock);

    const field = spawnField(mock, true);
    const view = mock.ctx.state.sync.views.get(field);
    const mask = maskOf(mock, field);
    const clipped = fake(view?.clipped);

    expect(mask?.ops).toEqual([{ op: "rect", x: 0, y: 0, width: 480, height: 96, radius: 0 }]);
    expect(mask?.fills).toEqual([{ color: 0xff_ff_ff }]);
    expect(mask?.strokes).toEqual([]);
    expect(mask?.label).toBe(`clip#${field}`);
    expect(clipped?.label).toBe(`children#${field}`);
    expect(clipped?.sortableChildren).toBe(true);
    expect(clipped?.mask).toBe(mask);
    expect(clipped?.parent).toBe(fake(view?.wrapper));
    expect(view?.wrapper?.mask).toBeNull();
    expect(mask?.parent).toBe(fake(view?.wrapper));
    expect(view?.wrapper?.position.x).toBe(40);
  });

  it("keeps the panel itself outside the mask and hangs the children under it", async () => {
    const mock = await started();

    provideField(mock);

    const field = spawnField(mock, true);
    const child = spawnChild(mock, field);
    const view = mock.ctx.state.sync.views.get(field);

    expect(fake(view?.object)?.parent).toBe(fake(view?.wrapper));
    expect(underMask(fake(view?.object))).toBe(false);
    expect(objectOf(mock, child)?.parent).toBe(fake(view?.clipped));
    expect(underMask(objectOf(mock, child))).toBe(true);
  });

  it("moves the children under the mask when clip is turned on, and back when it is off", async () => {
    const mock = await started();

    provideField(mock);

    const field = spawnField(mock, false);
    const child = spawnChild(mock, field);
    const view = mock.ctx.state.sync.views.get(field);

    expect(objectOf(mock, child)?.parent).toBe(fake(view?.wrapper));

    mock.world.ecs.set(field, NineSlice, { clip: true });
    mock.modules.sync.pass();

    const clipped = fake(view?.clipped);

    expect(objectOf(mock, child)?.parent).toBe(clipped);
    expect(underMask(fake(view?.object))).toBe(false);

    mock.world.ecs.set(field, NineSlice, { clip: false });
    mock.modules.sync.pass();

    expect(objectOf(mock, child)?.parent).toBe(fake(view?.wrapper));
    expect(underMask(objectOf(mock, child))).toBe(false);
    expect(view?.clipped).toBeUndefined();
    expect(clipped?.destroyed).toBe(true);
    expect(clipped?.children).toEqual([]);
  });

  it("keeps the Order of a child as its depth under the mask", async () => {
    const mock = await started();

    provideField(mock);

    const field = spawnField(mock, true);
    const low = spawnChild(mock, field, 1);
    const high = spawnChild(mock, field, 5);

    expect(objectOf(mock, low)?.zIndex).toBe(1);
    expect(objectOf(mock, high)?.zIndex).toBe(5);
    expect(objectOf(mock, high)?.parent).toBe(fake(mock.ctx.state.sync.views.get(field)?.clipped));
  });

  it("keeps the filters on the wrapper, over the panel and its children", async () => {
    const mock = await started();
    const glow = new FakeFilter();
    const slot: FilterSlot = { filter: glow as unknown as PixiFilter, passes: 1 };

    provideField(mock);

    const field = spawnField(mock, true);

    mock.api.sync.filters.set(field, [slot]);
    mock.modules.sync.pass();

    const view = mock.ctx.state.sync.views.get(field);

    expect(view?.wrapper?.filters).toEqual([glow]);
    expect(fake(view?.clipped)?.filters).toBeUndefined();
  });

  it("keeps the debug outline outside the mask", async () => {
    const mock = await started();

    provideField(mock);

    const field = spawnField(mock, true, true);
    const view = mock.ctx.state.sync.views.get(field);

    expect(fake(view?.outline)?.parent).toBe(fake(view?.wrapper));
    expect(underMask(fake(view?.outline))).toBe(false);
  });

  it("keeps the mask on the box when the size changes", async () => {
    const mock = await started();

    provideField(mock);

    const field = spawnField(mock, true);
    const mask = maskOf(mock, field);

    mock.world.ecs.set(field, NineSlice, { width: 600, height: 120 });
    mock.modules.sync.pass();

    expect(maskOf(mock, field)).toBe(mask);
    expect(mask?.ops).toEqual([{ op: "rect", x: 0, y: 0, width: 600, height: 120, radius: 0 }]);
  });

  it("removes the mask when clip is turned off", async () => {
    const mock = await started();

    provideField(mock);

    const field = spawnField(mock, true);
    const view = mock.ctx.state.sync.views.get(field);
    const mask = maskOf(mock, field);

    mock.world.ecs.set(field, NineSlice, { clip: false });
    mock.modules.sync.pass();

    expect(view?.mask).toBeUndefined();
    expect(view?.clipped).toBeUndefined();
    expect(view?.wrapper?.mask).toBeNull();
    expect(mask?.destroyed).toBe(true);
  });

  it("adds no mask and no wrapper while clip is off", async () => {
    const mock = await started();

    provideField(mock);

    const field = spawnField(mock, false);
    const view = mock.ctx.state.sync.views.get(field);

    expect(view?.mask).toBeUndefined();
    expect(view?.wrapper).toBeUndefined();
  });

  it("frees the mask and the children container when the entity leaves", async () => {
    const mock = await started();

    provideField(mock);

    const field = spawnField(mock, true);
    const mask = maskOf(mock, field);
    const clipped = fake(mock.ctx.state.sync.views.get(field)?.clipped);

    mock.world.ecs.despawn(field);
    mock.modules.sync.pass();

    expect(mask?.destroyed).toBe(true);
    expect(clipped?.destroyed).toBe(true);
  });

  it("detaches the children under the mask when the field leaves before them", async () => {
    const mock = await started();

    provideField(mock);

    const field = spawnField(mock, true);
    const child = spawnChild(mock, field);
    const warn = vi.spyOn(mock.ctx.log, "warn");

    mock.world.ecs.despawn(field);
    mock.modules.sync.pass();

    expect(objectOf(mock, child)?.parent).toBeNull();
    expect(warn).toHaveBeenCalledWith("renderer: parent left before its children", {
      parent: field,
      orphans: [child]
    });
  });

  it("hits nothing inside the box when the point is outside it", async () => {
    const mock = await started();

    provideField(mock);

    const field = spawnField(mock, true);
    const inside = mock.world.ecs.spawn(owner, [
      Transform({ x: 20, y: 20 }),
      Shape({ w: 40, h: 40 }),
      Parent({ entity: field })
    ]);

    mock.world.ecs.spawn(owner, [
      Transform({ x: 500, y: 20 }),
      Shape({ w: 40, h: 40 }),
      Parent({ entity: field })
    ]);
    mock.modules.sync.pass();

    expect(mock.api.sync.hitTest(70, 430, anyEntity)).toBe(inside);
    expect(mock.api.sync.hitTest(550, 430, anyEntity)).toBeUndefined();
  });
});
