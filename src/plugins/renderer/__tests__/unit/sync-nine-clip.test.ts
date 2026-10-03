import { afterEach, describe, expect, it, vi } from "vitest";
import { Layer } from "../../../world/ecs/define";
import { NineSlice, Parent, Shape, Transform } from "../../components";
import { type FakeGraphics, FakeTexture } from "../fake-pixi";
import { createMockRenderer, type MockRenderer } from "../mock-renderer";

// ---------------------------------------------------------------------------
// `NineSlice.clip`: the rule of `Shape.clip` on a nine-slice. The children of
// the entity are masked to the `width × height` box, and the mask is never drawn.
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

function spawnField(mock: MockRenderer, clip: boolean): number {
  const entity = mock.world.ecs.spawn(owner, [
    Layer({ name: "items" }),
    Transform({ x: 40, y: 400 }),
    NineSlice({ texture: "ui.field", width: 480, height: 96, clip })
  ]);

  mock.modules.sync.pass();

  return entity;
}

function maskOf(mock: MockRenderer, entity: number): FakeGraphics | undefined {
  return mock.ctx.state.sync.views.get(entity)?.mask as unknown as FakeGraphics | undefined;
}

describe("sync nine-slice clip", () => {
  it("masks the children to the box with a filled rectangle in the wrapper", async () => {
    const mock = await started();

    provideField(mock);

    const field = spawnField(mock, true);
    const view = mock.ctx.state.sync.views.get(field);
    const mask = maskOf(mock, field);

    expect(mask?.ops).toEqual([{ op: "rect", x: 0, y: 0, width: 480, height: 96, radius: 0 }]);
    expect(mask?.fills).toEqual([{ color: 0xff_ff_ff }]);
    expect(mask?.strokes).toEqual([]);
    expect(mask?.label).toBe(`clip#${field}`);
    expect(view?.wrapper?.mask).toBe(view?.mask);
    expect(mask?.parent).toBe(view?.wrapper);
    expect(view?.wrapper?.position.x).toBe(40);
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

  it("frees the mask when the entity leaves", async () => {
    const mock = await started();

    provideField(mock);

    const field = spawnField(mock, true);
    const mask = maskOf(mock, field);

    mock.world.ecs.despawn(field);
    mock.modules.sync.pass();

    expect(mask?.destroyed).toBe(true);
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
