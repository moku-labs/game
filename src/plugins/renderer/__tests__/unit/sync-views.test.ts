import { afterEach, describe, expect, it, vi } from "vitest";
import { Layer } from "../../../world/ecs/define";
import { Display, NineSlice, Parent, Sprite, Transform } from "../../components";
import { FakeContainer, type FakeSprite, FakeTexture } from "../fake-pixi";
import { createMockRenderer, type MockRenderer } from "../mock-renderer";

afterEach(() => {
  vi.unstubAllGlobals();
});

const owner = { kind: "plugin", name: "test" } as const;

async function started(): Promise<MockRenderer> {
  const mock = createMockRenderer();

  await mock.start();
  mock.world.projection.setLayers([{ name: "items", sort: "none" }]);
  mock.modules.sync.pass();

  return mock;
}

describe("sync views", () => {
  it("builds a display object for a spawned sprite and labels it", async () => {
    const mock = await started();
    const entity = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform({ x: 540, y: 300 }),
      Sprite({ texture: "board.cell" })
    ]);

    expect(mock.ctx.state.sync.added.has(entity)).toBe(true);

    mock.modules.sync.pass();

    const view = mock.ctx.state.sync.views.get(entity);

    expect(view?.kind).toBe("Sprite");
    expect(view?.poolKey).toBe("Sprite:board.cell");
    expect(view?.object.label).toBe(`Sprite#${entity}`);
    expect(view?.object.position.x).toBe(540);
    expect(view?.object.position.y).toBe(300);
    expect(mock.api.sync.displayOf(entity)).toBe(view?.object);
  });

  it("takes a view out of the tree when its component leaves", async () => {
    const mock = await started();
    const entity = mock.world.ecs.spawn(owner, [Layer({ name: "items" }), Transform(), Sprite()]);

    mock.modules.sync.pass();
    mock.world.ecs.despawn(entity);

    expect(mock.ctx.state.sync.removed.has(entity)).toBe(true);

    mock.modules.sync.pass();

    expect(mock.ctx.state.sync.views.has(entity)).toBe(false);
    expect(mock.api.sync.displayOf(entity)).toBeUndefined();
    expect(mock.ctx.state.sync.layers.get("items")?.container?.children).toHaveLength(0);
  });

  it("touches only the entities the frame changed", async () => {
    const mock = await started();
    const moved = mock.world.ecs.spawn(owner, [Layer({ name: "items" }), Transform(), Sprite()]);
    const still = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform({ x: 5 }),
      Sprite()
    ]);

    mock.modules.sync.pass();
    mock.world.clearChanges();

    const stillObject = mock.ctx.state.sync.views.get(still)?.object;

    if (stillObject !== undefined) stillObject.position.set(-1, -1);

    mock.world.ecs.set(moved, Transform, { x: 42 });
    mock.modules.sync.pass();

    expect(mock.ctx.state.sync.views.get(moved)?.object.position.x).toBe(42);
    expect(stillObject?.position.x).toBe(-1);
  });

  it("attaches and detaches the object a Display component carries", async () => {
    const mock = await started();
    const object = new FakeContainer();
    const entity = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform(),
      Display({ object })
    ]);

    mock.modules.sync.pass();

    expect(mock.ctx.state.sync.views.get(entity)?.kind).toBe("Display");
    expect(object.parent).toBe(mock.ctx.state.sync.layers.get("items")?.container);
    expect(mock.ctx.state.sync.views.get(entity)?.hitBox).toEqual({
      x: -50,
      y: -50,
      width: 100,
      height: 100
    });

    mock.world.ecs.despawn(entity);
    mock.modules.sync.pass();

    expect(object.destroyed).toBe(false);
    expect(object.parent).toBeNull();
  });

  it("reports an entity that carries two visuals and keeps the first", async () => {
    const mock = await started();
    const entity = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform(),
      Sprite({ texture: "a" }),
      NineSlice({ texture: "b", width: 10, height: 10 })
    ]);

    mock.modules.sync.pass();

    expect(mock.ctx.state.sync.views.get(entity)?.kind).toBe("Sprite");
    expect(mock.log.warn).toHaveBeenCalledWith(
      "renderer: entity has more than one visual",
      expect.objectContaining({ kinds: ["Sprite", "NineSlice"] })
    );
  });

  it("writes the nine-slice size in reference units", async () => {
    const mock = await started();

    mock.api.sync.textures.provide(() => FakeTexture.WHITE as never);

    const entity = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform(),
      NineSlice({ texture: "ui.panel", width: 600, height: 320 })
    ]);

    mock.modules.sync.pass();

    const view = mock.ctx.state.sync.views.get(entity);

    expect(view?.kind).toBe("NineSlice");
    expect(view?.hitBox).toEqual({ x: 0, y: 0, width: 600, height: 320 });
  });

  it("builds every existing entity again on rebuildAll", async () => {
    const mock = await started();
    const entity = mock.world.ecs.spawn(owner, [Layer({ name: "items" }), Transform(), Sprite()]);

    mock.modules.sync.pass();

    const before = mock.ctx.state.sync.views.get(entity)?.object;

    mock.modules.sync.rebuildAll();

    const after = mock.ctx.state.sync.views.get(entity)?.object;

    expect(after).toBeDefined();
    expect(after).not.toBe(before);
    expect(mock.ctx.state.sync.root?.children.map(child => child.label)).toEqual(["layer:items"]);
  });

  it("detaches the children of a parent that left, and names them", async () => {
    const mock = await started();
    const parent = mock.world.ecs.spawn(owner, [Layer({ name: "items" }), Transform(), Sprite()]);

    mock.modules.sync.pass();

    const child = mock.world.ecs.spawn(owner, [Transform(), Sprite(), Parent({ entity: parent })]);

    mock.modules.sync.pass();

    const childObject = mock.ctx.state.sync.views.get(child)?.object;

    mock.world.ecs.despawn(parent);
    mock.modules.sync.pass();

    expect(childObject?.parent).toBeNull();
    expect(mock.log.warn).toHaveBeenCalledWith(
      "renderer: parent left before its children",
      expect.objectContaining({ parent })
    );
  });

  it("does not draw a child whose parent draws nothing", async () => {
    const mock = await started();
    const child = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform(),
      Sprite(),
      Parent({ entity: 999_999 })
    ]);

    mock.modules.sync.pass();

    expect(mock.ctx.state.sync.views.get(child)?.object.parent).toBeNull();
    expect(mock.log.warn).toHaveBeenCalledWith(
      "renderer: parent draws nothing",
      expect.objectContaining({ entity: child })
    );
  });

  it("registers nothing and builds nothing while inert", async () => {
    const mock = createMockRenderer({ dom: false });

    await mock.start();
    mock.modules.sync.start();
    mock.modules.sync.rebuildAll();

    expect(mock.ctx.state.sync.cleanups).toHaveLength(0);
    expect(mock.ctx.state.sync.root).toBeUndefined();
    expect(mock.ctx.state.sync.views.size).toBe(0);
  });

  it("draws a view that carries no Transform at the origin", async () => {
    const mock = createMockRenderer();

    await mock.start();
    mock.world.projection.setLayers([{ name: "items", sort: "y" }]);
    mock.modules.sync.pass();

    const entity = mock.world.ecs.spawn(owner, [Layer({ name: "items" }), Sprite()]);

    mock.modules.sync.pass();

    const view = mock.ctx.state.sync.views.get(entity);

    expect(view?.object.position.x).toBe(0);
    expect(view?.object.zIndex).toBe(0);
  });

  it("reports the entity when building its view throws, and goes on", async () => {
    const mock = await started();
    const broken = new FakeContainer();

    broken.getLocalBounds = (): never => {
      throw new Error("no bounds");
    };

    const entity = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform(),
      Display({ object: broken })
    ]);
    const healthy = mock.world.ecs.spawn(owner, [Layer({ name: "items" }), Transform(), Sprite()]);

    mock.modules.sync.pass();

    expect(mock.log.error).toHaveBeenCalledWith(
      "renderer: sync failed for an entity",
      expect.objectContaining({ entity })
    );
    expect(mock.ctx.state.sync.views.has(healthy)).toBe(true);
  });

  it("follows a sprite that changes its texture key into another pool", async () => {
    const mock = await started();
    const entity = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform(),
      Sprite({ texture: "board.cell" })
    ]);

    mock.modules.sync.pass();
    expect(mock.ctx.state.sync.byKey.get("board.cell")?.has(entity)).toBe(true);

    mock.world.ecs.set(entity, Sprite, { texture: "board.chain" });
    mock.modules.sync.pass();

    expect(mock.ctx.state.sync.views.get(entity)?.poolKey).toBe("Sprite:board.chain");
    expect(mock.ctx.state.sync.byKey.has("board.cell")).toBe(false);
    expect(mock.ctx.state.sync.byKey.get("board.chain")?.has(entity)).toBe(true);
  });

  it("draws nothing for a Display that holds no display object", async () => {
    const mock = await started();
    const entity = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform(),
      Display({ object: 42 })
    ]);

    mock.modules.sync.pass();

    expect(mock.ctx.state.sync.views.has(entity)).toBe(false);
    expect(mock.log.warn).toHaveBeenCalledWith(
      "renderer: Display holds no display object",
      expect.objectContaining({ entity })
    );
  });
});

/**
 * A texture of one size, answered for every key.
 *
 * @param mock - The mock renderer.
 * @param width - Pixel width.
 * @param height - Pixel height.
 * @returns The texture the provider answers.
 */
function provideSized(mock: MockRenderer, width: number, height: number): FakeTexture {
  const texture = new FakeTexture({ source: { width, height, destroyed: false } });

  mock.api.sync.textures.provide(() => texture as never);

  return texture;
}

/**
 * Spawns a sprite in the `items` layer and builds its view.
 *
 * @param mock - The mock renderer.
 * @param sprite - The sprite fields.
 * @param place - The transform fields.
 * @returns The entity and the sprite object that draws it.
 */
function drawSprite(
  mock: MockRenderer,
  sprite: Parameters<typeof Sprite>[0],
  place: Parameters<typeof Transform>[0] = {}
): { entity: number; object: FakeSprite } {
  const entity = mock.world.ecs.spawn(owner, [
    Layer({ name: "items" }),
    Transform(place),
    Sprite(sprite)
  ]);

  mock.modules.sync.pass();

  const object = mock.ctx.state.sync.views.get(entity)?.object as unknown as FakeSprite;

  return { entity, object };
}

describe("sync views: sprite size and fit", () => {
  it("draws a sprite without a size at its texture's own size", async () => {
    const mock = await started();

    provideSized(mock, 200, 100);

    const { entity, object } = drawSprite(mock, { texture: "board.bg" });

    expect(object.scale.x).toBe(1);
    expect(object.scale.y).toBe(1);
    expect(mock.ctx.state.sync.views.get(entity)?.hitBox).toEqual({
      x: -100,
      y: -50,
      width: 200,
      height: 100
    });
  });

  it("stretches a fill sprite to its box, and the box is the hit box", async () => {
    const mock = await started();

    provideSized(mock, 200, 100);

    const { entity, object } = drawSprite(mock, {
      texture: "board.bg",
      width: 100,
      height: 100,
      fit: "fill"
    });

    expect(object.scale.x).toBe(0.5);
    expect(object.scale.y).toBe(1);
    expect(object.anchor.x).toBe(0.5);
    expect(object.anchor.y).toBe(0.5);
    expect(mock.ctx.state.sync.views.get(entity)?.hitBox).toEqual({
      x: -50,
      y: -50,
      width: 100,
      height: 100
    });
  });

  it("keeps the texture's own size on an axis whose size is zero", async () => {
    const mock = await started();

    provideSized(mock, 200, 100);

    const { entity, object } = drawSprite(mock, { texture: "board.bg", width: 400 });

    expect(object.scale.x).toBe(2);
    expect(object.scale.y).toBe(1);
    expect(mock.ctx.state.sync.views.get(entity)?.hitBox).toEqual({
      x: -200,
      y: -50,
      width: 400,
      height: 100
    });
  });

  it("scales a contain sprite uniformly inside its box and centres it", async () => {
    const mock = await started();

    provideSized(mock, 200, 100);

    const { entity, object } = drawSprite(mock, {
      texture: "board.bg",
      width: 100,
      height: 100,
      fit: "contain",
      anchor: { x: 0, y: 0 }
    });

    // Drawn 100 x 50 inside the 100 x 100 box at the top left: the picture starts 25 units down.
    expect(object.scale.x).toBe(0.5);
    expect(object.scale.y).toBe(0.5);
    expect(object.anchor.x).toBe(0);
    expect(-object.anchor.y * object.texture.height * object.scale.y).toBe(25);
    expect(mock.ctx.state.sync.views.get(entity)?.hitBox).toEqual({
      x: 0,
      y: 0,
      width: 100,
      height: 100
    });
  });

  it("keeps the centred anchor of a contain sprite in the middle of its box", async () => {
    const mock = await started();

    provideSized(mock, 100, 200);

    const { object } = drawSprite(mock, {
      texture: "board.item",
      width: 64,
      height: 64,
      fit: "contain"
    });

    expect(object.scale.x).toBe(0.32);
    expect(object.scale.y).toBe(0.32);
    expect(object.anchor.x).toBe(0.5);
    expect(object.anchor.y).toBe(0.5);
  });

  it("crops a cover sprite through a sub-frame of its texture, never stretching it", async () => {
    const mock = await started();
    const base = provideSized(mock, 200, 100);
    const { entity, object } = drawSprite(mock, {
      texture: "board.bg",
      width: 100,
      height: 100,
      fit: "cover"
    });

    expect(object.texture).not.toBe(base);
    expect(object.texture.source).toBe(base.source);
    expect({ ...object.texture.frame }).toEqual({ x: 50, y: 0, width: 100, height: 100 });
    expect(object.scale.x).toBe(1);
    expect(object.scale.y).toBe(1);
    expect(mock.ctx.state.sync.views.get(entity)?.hitBox).toEqual({
      x: -50,
      y: -50,
      width: 100,
      height: 100
    });
  });

  it("scales a cover sprite up by the larger ratio and crops the other axis", async () => {
    const mock = await started();

    provideSized(mock, 100, 200);

    const { object } = drawSprite(
      mock,
      { texture: "board.bg", width: 300, height: 300, fit: "cover" },
      { scale: 2 }
    );

    expect({ ...object.texture.frame }).toEqual({ x: 0, y: 50, width: 100, height: 100 });
    expect(object.scale.x).toBe(6);
    expect(object.scale.y).toBe(6);
  });

  it("cuts one sub-frame per texture key and box, and frees it with its base", async () => {
    const mock = await started();
    const base = provideSized(mock, 200, 100);
    const cover = { texture: "board.bg", width: 100, height: 100, fit: "cover" } as const;
    const first = drawSprite(mock, cover);
    const second = drawSprite(mock, cover);
    const other = drawSprite(mock, { ...cover, width: 50 });

    expect(second.object.texture).toBe(first.object.texture);
    expect(other.object.texture).not.toBe(first.object.texture);

    const cut = first.object.texture;

    mock.api.sync.textures.destroy(base as never);

    expect(cut.destroyed).toBe(true);
    expect(cut.destroyedSource).toBe(false);
    expect(base.source.destroyed).toBe(true);
    expect(mock.ctx.state.sync.frames.size).toBe(0);
  });

  it("keeps the crops of another texture when one texture is destroyed", async () => {
    const mock = await started();
    const meadow = new FakeTexture({ source: { width: 200, height: 100, destroyed: false } });
    const sawmill = new FakeTexture({ source: { width: 100, height: 200, destroyed: false } });

    mock.api.sync.textures.provide(key => (key === "board.bg" ? meadow : sawmill) as never);

    const cover = { width: 100, height: 100, fit: "cover" } as const;
    const kept = drawSprite(mock, { ...cover, texture: "home.bg" });

    drawSprite(mock, { ...cover, texture: "board.bg" });
    mock.api.sync.textures.destroy(meadow as never);

    expect(kept.object.texture.destroyed).toBe(false);
    expect(mock.ctx.state.sync.frames.size).toBe(1);
  });

  it("draws a texture without area as it is, in the box it was given", async () => {
    const mock = await started();

    provideSized(mock, 0, 0);

    const { entity, object } = drawSprite(mock, { texture: "board.empty", width: 100 });

    expect(object.scale.x).toBe(1);
    expect(object.scale.y).toBe(1);
    expect(mock.ctx.state.sync.views.get(entity)?.hitBox).toEqual({
      x: -50,
      y: 0,
      width: 100,
      height: 0
    });
  });

  it("keeps exactly one crop for a cover sprite resized three times", async () => {
    const mock = await started();

    provideSized(mock, 200, 100);

    const { entity, object } = drawSprite(mock, {
      texture: "board.bg",
      width: 100,
      height: 100,
      fit: "cover"
    });
    const first = object.texture;

    for (const width of [120, 140, 160]) {
      mock.world.ecs.set(entity, Sprite, { width });
      mock.modules.sync.pass();
    }

    expect(mock.ctx.state.sync.frames.size).toBe(1);
    expect(first.destroyed).toBe(true);
    expect(first.destroyedSource).toBe(false);
    expect(object.texture.destroyed).toBe(false);
    expect({ ...object.texture.frame }).toEqual({ x: 20, y: 0, width: 160, height: 100 });
  });

  it("shares one crop between two sprites of one box until both leave", async () => {
    const mock = await started();

    provideSized(mock, 200, 100);

    const cover = { texture: "board.bg", width: 100, height: 100, fit: "cover" } as const;
    const first = drawSprite(mock, cover);
    const second = drawSprite(mock, cover);
    const cut = first.object.texture;

    expect(second.object.texture).toBe(cut);

    mock.world.ecs.despawn(first.entity);
    mock.modules.sync.pass();

    expect(cut.destroyed).toBe(false);
    expect(mock.ctx.state.sync.frames.size).toBe(1);

    mock.world.ecs.despawn(second.entity);
    mock.modules.sync.pass();

    expect(cut.destroyed).toBe(true);
    expect(cut.destroyedSource).toBe(false);
    expect(mock.ctx.state.sync.frames.size).toBe(0);
  });

  it("lets go of its crop when a cover sprite changes its key or stops covering", async () => {
    const mock = await started();

    provideSized(mock, 200, 100);

    const { entity, object } = drawSprite(mock, {
      texture: "board.bg",
      width: 100,
      height: 100,
      fit: "cover"
    });
    const byKey = object.texture;

    mock.world.ecs.set(entity, Sprite, { texture: "home.bg" });
    mock.modules.sync.pass();

    expect(byKey.destroyed).toBe(true);

    const byFit = object.texture;

    mock.world.ecs.set(entity, Sprite, { fit: "fill" });
    mock.modules.sync.pass();

    expect(byFit.destroyed).toBe(true);
    expect(mock.ctx.state.sync.frames.size).toBe(0);
  });

  it("gives a pooled cover sprite back without the crop it showed", async () => {
    const mock = await started();

    provideSized(mock, 200, 100);

    const { entity, object } = drawSprite(mock, {
      texture: "board.bg",
      width: 100,
      height: 100,
      fit: "cover"
    });

    mock.world.ecs.despawn(entity);
    mock.modules.sync.pass();

    expect(object.texture).toBe(FakeTexture.WHITE);
  });

  it("cuts a new sub-frame when the key answers a new texture", async () => {
    const mock = await started();
    const older = provideSized(mock, 200, 100);
    const cover = { texture: "board.bg", width: 100, height: 100, fit: "cover" } as const;
    const first = drawSprite(mock, cover);
    const oldCut = first.object.texture;

    provideSized(mock, 400, 100);
    mock.api.sync.textures.invalidate(["board.bg"]);
    mock.modules.sync.pass();

    expect(oldCut.destroyed).toBe(true);
    expect(oldCut.destroyedSource).toBe(false);
    expect(first.object.texture.source).not.toBe(older.source);
    expect({ ...first.object.texture.frame }).toEqual({ x: 150, y: 0, width: 100, height: 100 });
  });

  it("frees every sub-frame when the renderer stops", async () => {
    const mock = await started();

    provideSized(mock, 200, 100);

    const { object } = drawSprite(mock, {
      texture: "board.bg",
      width: 100,
      height: 100,
      fit: "cover"
    });
    const cut = object.texture;

    mock.stop();

    expect(cut.destroyed).toBe(true);
    expect(cut.destroyedSource).toBe(false);
    expect(mock.ctx.state.sync.frames.size).toBe(0);
  });

  it("draws the placeholder of a sized sprite at its box", async () => {
    const mock = await started();
    const { entity, object } = drawSprite(mock, {
      texture: "board.missing",
      width: 120,
      height: 80,
      fit: "cover"
    });

    expect(object.tint).toBe(0xff_00_ff);
    expect(object.scale.x).toBe(120);
    expect(object.scale.y).toBe(80);
    expect(mock.ctx.state.sync.views.get(entity)?.hitBox).toEqual({
      x: -60,
      y: -40,
      width: 120,
      height: 80
    });
  });

  it("follows a size change of the Sprite on the next pass", async () => {
    const mock = await started();

    provideSized(mock, 200, 100);

    const { entity, object } = drawSprite(mock, { texture: "board.bg" }, { scale: 2 });

    mock.world.ecs.set(entity, Sprite, { width: 100, height: 100, fit: "fill" });
    mock.modules.sync.pass();

    expect(object.scale.x).toBe(1);
    expect(object.scale.y).toBe(2);
  });
});

describe("sync views: nine-slice alpha and tint", () => {
  it("writes the alpha and the tint of a nine-slice, and follows a change", async () => {
    const mock = await started();

    mock.api.sync.textures.provide(() => new FakeTexture({}) as never);

    const entity = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform(),
      NineSlice({ texture: "ui.panel", width: 600, height: 320, alpha: 0.5, tint: 0xff_00_00 })
    ]);

    mock.modules.sync.pass();

    const object = mock.ctx.state.sync.views.get(entity)?.object;

    expect(object?.alpha).toBe(0.5);
    expect(object).toHaveProperty("tint", 0xff_00_00);

    mock.world.ecs.set(entity, NineSlice, { alpha: 0.25, tint: 0x00_ff_00 });
    mock.modules.sync.pass();

    expect(object?.alpha).toBe(0.25);
    expect(object).toHaveProperty("tint", 0x00_ff_00);
  });

  it("keeps the magenta tint on a nine-slice whose texture is missing", async () => {
    const mock = await started();
    const entity = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform(),
      NineSlice({ texture: "ui.missing", width: 60, height: 30, alpha: 0.5, tint: 0xff_00_00 })
    ]);

    mock.modules.sync.pass();

    const object = mock.ctx.state.sync.views.get(entity)?.object;

    expect(object).toHaveProperty("tint", 0xff_00_ff);
    expect(object?.alpha).toBe(0.5);
  });
});

describe("sync views: pivot", () => {
  it("sets the pivot of a view, so its position is where the pivot lands", async () => {
    const mock = await started();

    provideSized(mock, 64, 64);

    const { object } = drawSprite(
      mock,
      { texture: "board.cell" },
      { x: 100, y: 50, pivot: { x: 10, y: 20 } }
    );

    expect(object.position.x).toBe(100);
    expect(object.position.y).toBe(50);
    expect(object.pivot.x).toBe(10);
    expect(object.pivot.y).toBe(20);
  });

  it("writes the pivot in the object's own units when the sprite is stretched", async () => {
    const mock = await started();

    provideSized(mock, 200, 100);

    const { object } = drawSprite(
      mock,
      { texture: "board.bg", width: 100, height: 100 },
      { pivot: { x: 10, y: 20 } }
    );

    expect(object.pivot.x).toBe(20);
    expect(object.pivot.y).toBe(20);
  });

  it("puts the pivot on the wrapper of a parent, and draws its own visual unmoved inside", async () => {
    const mock = await started();

    provideSized(mock, 200, 100);

    const { entity, object } = drawSprite(
      mock,
      { texture: "board.bg", width: 100, height: 100 },
      { x: 300, y: 200, rotation: 0.5, scale: 2, pivot: { x: 10, y: 20 } }
    );

    mock.world.ecs.spawn(owner, [Transform(), Sprite(), Parent({ entity })]);
    mock.modules.sync.pass();

    const wrapper = mock.ctx.state.sync.views.get(entity)?.wrapper;

    expect(wrapper?.position.x).toBe(300);
    expect(wrapper?.rotation).toBe(0.5);
    expect(wrapper?.scale.x).toBe(2);
    expect(wrapper?.pivot.x).toBe(10);
    expect(wrapper?.pivot.y).toBe(20);
    expect(object.position.x).toBe(0);
    expect(object.rotation).toBe(0);
    expect(object.pivot.x).toBe(0);
    expect(object.scale.x).toBe(0.5);
    expect(object.scale.y).toBe(1);

    mock.world.ecs.set(entity, Transform, { pivot: { x: 4, y: 6 } });
    mock.modules.sync.pass();

    expect(wrapper?.pivot.x).toBe(4);
    expect(object.pivot.x).toBe(0);
  });

  it("gives a pooled object back without its pivot", async () => {
    const mock = await started();

    provideSized(mock, 64, 64);

    const { entity, object } = drawSprite(
      mock,
      { texture: "board.cell" },
      { pivot: { x: 10, y: 20 } }
    );

    mock.world.ecs.despawn(entity);
    mock.modules.sync.pass();

    expect(object.pivot.x).toBe(0);
    expect(object.pivot.y).toBe(0);
  });
});

/**
 * A texture with nine-slice insets, as `textures.create` makes one from a `{nine=…}` file.
 *
 * @param borders - Left, top, right and bottom in pixels.
 * @param borders.left - Left inset.
 * @param borders.top - Top inset.
 * @param borders.right - Right inset.
 * @param borders.bottom - Bottom inset.
 * @param resolution - Resolution of the source; 1 when left out.
 * @returns The texture.
 */
function bordered(
  borders: { left: number; top: number; right: number; bottom: number },
  resolution?: number
): FakeTexture {
  return new FakeTexture({
    source: {
      width: 300,
      height: 300,
      destroyed: false,
      ...(resolution === undefined ? {} : { resolution })
    },
    defaultBorders: borders
  });
}

/**
 * Spawns a nine-slice in the `items` layer and builds its view.
 *
 * @param mock - The mock renderer.
 * @param texture - The asset key.
 * @returns The entity and the nine-slice object that draws it.
 */
function drawNine(mock: MockRenderer, texture: string): { entity: number; object: object } {
  const entity = mock.world.ecs.spawn(owner, [
    Layer({ name: "items" }),
    Transform(),
    NineSlice({ texture, width: 1000, height: 1040 })
  ]);

  mock.modules.sync.pass();

  return { entity, object: mock.ctx.state.sync.views.get(entity)?.object ?? {} };
}

/**
 * The four slice widths of a nine-slice object.
 *
 * @param object - The object.
 * @returns Left, top, right and bottom as the object holds them.
 */
function slices(object: object): unknown[] {
  return ["leftWidth", "topHeight", "rightWidth", "bottomHeight"].map(
    field => (object as Record<string, unknown>)[field]
  );
}

describe("sync views: nine-slice borders", () => {
  it("copies the insets of the texture into the four slice widths", async () => {
    const mock = await started();
    const board = bordered({ left: 72, top: 76, right: 72, bottom: 76 });

    mock.api.sync.textures.provide(() => board as never);

    const { object } = drawNine(mock, "board.board-tray");

    expect(slices(object)).toEqual([72, 76, 72, 76]);
  });

  it("gives a texture without insets slices of 0, not Pixi's 10", async () => {
    const mock = await started();

    mock.api.sync.textures.provide(() => new FakeTexture({}) as never);

    const { object } = drawNine(mock, "ui.plain");

    expect(slices(object)).toEqual([0, 0, 0, 0]);
  });

  it("follows the insets when the entity names another texture", async () => {
    const mock = await started();
    const textures: Record<string, FakeTexture> = {
      "ui.panel": bordered({ left: 48, top: 48, right: 48, bottom: 48 }),
      "ui.signboard": bordered({ left: 72, top: 72, right: 72, bottom: 76 })
    };

    mock.api.sync.textures.provide(key => textures[key] as never);

    const { entity, object } = drawNine(mock, "ui.panel");

    mock.world.ecs.set(entity, NineSlice, { texture: "ui.signboard" });
    mock.modules.sync.pass();

    expect(slices(object)).toEqual([72, 72, 72, 76]);
  });

  it("follows the insets when a bundle brings new art for the same key", async () => {
    const mock = await started();
    let art = bordered({ left: 72, top: 72, right: 72, bottom: 72 });

    mock.api.sync.textures.provide(() => art as never);

    const { object } = drawNine(mock, "board.board-tray");

    art = bordered({ left: 96, top: 96, right: 96, bottom: 96 });
    mock.api.sync.textures.invalidate(["board.board-tray"]);
    mock.modules.sync.pass();

    expect(slices(object)).toEqual([96, 96, 96, 96]);
  });

  it("draws the insets in reference units when the source is not at resolution 1", async () => {
    const mock = await started();
    const board = bordered({ left: 144, top: 152, right: 144, bottom: 152 }, 2);

    mock.api.sync.textures.provide(() => board as never);

    const { object } = drawNine(mock, "board.board-tray");

    expect(slices(object)).toEqual([72, 76, 72, 76]);
  });

  it("gives the placeholder of a missing texture slices of 0", async () => {
    const mock = await started();
    const { object } = drawNine(mock, "ui.missing");

    expect(slices(object)).toEqual([0, 0, 0, 0]);
  });
});
