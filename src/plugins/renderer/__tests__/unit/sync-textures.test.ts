import { afterEach, describe, expect, it, vi } from "vitest";
import { Layer } from "../../../world/ecs/define";
import { NineSlice, Sprite, Transform } from "../../components";
import type { NineBorders, PixiTexture, SliceFrame } from "../../types";
import { FakeRectangle, type FakeSprite, FakeTexture } from "../fake-pixi";
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

function spawnSprite(mock: MockRenderer, texture: string): number {
  return mock.world.ecs.spawn(owner, [Layer({ name: "items" }), Transform(), Sprite({ texture })]);
}

describe("sync textures", () => {
  it("asks the newest provider first and takes the first answer", async () => {
    const mock = await started();
    const older = new FakeTexture({});
    const newer = new FakeTexture({});

    mock.api.sync.textures.provide(() => older as never);
    mock.api.sync.textures.provide(() => newer as never);

    const entity = spawnSprite(mock, "board.cell");

    mock.modules.sync.pass();

    const object = mock.ctx.state.sync.views.get(entity)?.object;

    expect(object).toHaveProperty("texture", newer);
  });

  it("stops asking a provider that was removed", async () => {
    const mock = await started();
    const texture = new FakeTexture({});
    const off = mock.api.sync.textures.provide(() => texture as never);

    off();
    off();

    const entity = spawnSprite(mock, "board.cell");

    mock.modules.sync.pass();

    expect(mock.ctx.state.sync.views.get(entity)?.placeholder).toBe(true);
  });

  it("draws the magenta placeholder and warns once per key", async () => {
    const mock = await started();

    spawnSprite(mock, "board.cell");
    spawnSprite(mock, "board.cell");
    mock.modules.sync.pass();

    const container = mock.ctx.state.sync.layers.get("items")?.container;

    expect(container?.children).toHaveLength(2);
    expect(container?.children[0]).toHaveProperty("tint", 0xff_00_ff);
    expect(container?.children[0]?.scale.x).toBe(64);
    expect(
      vi
        .mocked(mock.log.warn)
        .mock.calls.filter(call => call[0] === "renderer: no texture for asset key")
    ).toHaveLength(1);
  });

  it("does not ask again for a missing key until it is invalidated", async () => {
    const mock = await started();
    let asks = 0;

    mock.api.sync.textures.provide(() => {
      asks += 1;

      return undefined;
    });
    spawnSprite(mock, "board.cell");
    mock.modules.sync.pass();
    mock.world.clearChanges();

    const afterCreate = asks;

    mock.modules.sync.pass();
    mock.modules.sync.pass();

    expect(asks).toBe(afterCreate);
  });

  it("heals a placeholder when the bundle arrives and is invalidated", async () => {
    const mock = await started();
    const loaded = new Map<string, FakeTexture>();

    mock.api.sync.textures.provide(key => loaded.get(key) as never);

    const entity = spawnSprite(mock, "board.cell");

    mock.modules.sync.pass();
    expect(mock.ctx.state.sync.views.get(entity)?.placeholder).toBe(true);

    loaded.set("board.cell", new FakeTexture({}));
    mock.api.sync.textures.invalidate(["board.cell"]);
    mock.modules.sync.pass();

    const view = mock.ctx.state.sync.views.get(entity);

    expect(view?.placeholder).toBe(false);
    expect(view?.object).toHaveProperty("texture", loaded.get("board.cell"));
    expect(view?.object.scale.x).toBe(1);
  });

  it("destroys the pooled objects of an invalidated key", async () => {
    const mock = await started();
    const entity = spawnSprite(mock, "board.cell");

    mock.modules.sync.pass();
    mock.world.ecs.despawn(entity);
    mock.modules.sync.pass();

    const pooled = mock.ctx.state.sync.pools.get("Sprite:board.cell")?.[0];

    mock.api.sync.textures.invalidate(["board.cell"]);

    expect(pooled?.destroyed).toBe(true);
    expect(mock.ctx.state.sync.pools.has("Sprite:board.cell")).toBe(false);
    expect(mock.ctx.state.sync.pooled).toBe(0);
  });

  it("invalidates a key nothing uses without touching anything", async () => {
    const mock = await started();

    mock.api.sync.textures.invalidate(["nobody.uses.this"]);
    mock.modules.sync.pass();

    expect(mock.ctx.state.sync.invalidated.size).toBe(0);
    expect(mock.ctx.state.sync.pools.size).toBe(0);
  });

  it("removes a provider that is no longer in the chain", async () => {
    const mock = await started();
    const off = mock.api.sync.textures.provide(() => undefined);

    mock.ctx.state.sync.providers.length = 0;
    off();

    expect(mock.ctx.state.sync.providers).toHaveLength(0);
  });

  it("makes a texture and writes the nine-slice borders", async () => {
    const mock = await started();
    const plain = mock.api.sync.textures.create({ width: 32, height: 32 } as never);
    const nine = mock.api.sync.textures.create({ width: 64, height: 64 } as never, {
      nine: [12, 10, 8, 6]
    });

    expect(plain).toHaveProperty("source");
    expect(nine).toHaveProperty("defaultBorders", { left: 12, top: 10, right: 8, bottom: 6 });
  });

  it("frees the wrapper texture of a nine-slice and keeps its source", async () => {
    const mock = await started();
    const before = FakeTexture.made.length;
    const nine = mock.api.sync.textures.create({ width: 64, height: 64 } as never, {
      nine: [1, 2, 3, 4]
    });
    const wrapper = FakeTexture.made[before];

    expect(wrapper?.destroyed).toBe(true);
    expect(wrapper?.source.destroyed).toBe(false);
    expect(nine).toHaveProperty("destroyed", false);
    expect(nine.source).toBe(wrapper?.source);
  });

  it("refuses to make a texture while the device is lost", async () => {
    const mock = await started();

    mock.ctx.state.host.ready = false;

    expect(() => mock.api.sync.textures.create({ width: 8, height: 8 } as never)).toThrow(
      "[game] renderer.sync.textures.create needs a ready renderer."
    );
  });

  it("frees a texture once, however often it is asked", async () => {
    const mock = await started();
    const texture = new FakeTexture({});

    mock.api.sync.textures.destroy(texture as never);
    mock.api.sync.textures.destroy(texture as never);

    expect(texture.destroyCalls).toBe(1);
    expect(texture.source.destroyed).toBe(true);
  });

  it("lets go of the change listeners of a source it frees, the style first", async () => {
    const mock = await started();
    const texture = new FakeTexture({});

    mock.api.sync.textures.destroy(texture as never);
    mock.api.sync.textures.destroy(texture as never);

    // Pixi keeps bind groups that listen there for good: gone before the source, and only once.
    expect(texture.source.released).toEqual(["style:change", "change"]);
    expect(texture.releasedBeforeDestroy).toEqual(["style:change", "change"]);
  });
});

/**
 * A 512 x 512 atlas page, made the way `assets` makes it: one texture over the whole source.
 *
 * @param mock - The mock renderer, started.
 * @returns The page.
 */
function pageOf(mock: MockRenderer): FakeTexture {
  return mock.api.sync.textures.create({ width: 512, height: 512 } as never) as never;
}

/**
 * Cuts a slice out of a page.
 *
 * @param mock - The mock renderer, started.
 * @param page - The page.
 * @param frame - The frame in page pixels.
 * @param nine - Nine-slice borders, when the file has them.
 * @returns The slice.
 */
function sliceOf(
  mock: MockRenderer,
  page: FakeTexture,
  frame: SliceFrame,
  nine?: NineBorders
): FakeTexture {
  const texture: PixiTexture = mock.api.sync.textures.slice(
    page as never,
    frame,
    nine === undefined ? undefined : { nine }
  );

  return texture as never;
}

describe("sync textures: a slice out of an atlas page", () => {
  it("shares the page's source and shows the frame it was cut at", async () => {
    const mock = await started();
    const page = pageOf(mock);
    const slice = sliceOf(mock, page, { x: 100, y: 50, width: 256, height: 128 });

    expect(slice).not.toBe(page);
    expect(slice.source).toBe(page.source);
    expect({ ...slice.frame }).toEqual({ x: 100, y: 50, width: 256, height: 128 });
    expect(slice.width).toBe(256);
    expect(slice.height).toBe(128);
    expect(slice.defaultBorders).toBeUndefined();
    expect(mock.ctx.state.sync.slices.has(slice as never)).toBe(true);
    expect(mock.ctx.state.sync.slices.has(page as never)).toBe(false);
  });

  it("offsets the frame by the page's own frame, so a slice of a slice stays honest", async () => {
    const mock = await started();
    const page = pageOf(mock);
    const outer = sliceOf(mock, page, { x: 100, y: 50, width: 256, height: 128 });
    const inner = sliceOf(mock, outer, { x: 16, y: 8, width: 64, height: 32 });

    expect(inner.source).toBe(page.source);
    expect({ ...inner.frame }).toEqual({ x: 116, y: 58, width: 64, height: 32 });
  });

  it("writes the nine-slice borders of `nine` into the slice's default borders", async () => {
    const mock = await started();
    const button = sliceOf(
      mock,
      pageOf(mock),
      { x: 0, y: 0, width: 256, height: 128 },
      [24, 20, 16, 12]
    );

    expect(button.defaultBorders).toEqual({ left: 24, top: 20, right: 16, bottom: 12 });
  });

  it("draws a nine-slice from a slice with the borders the slice carries", async () => {
    const mock = await started();
    const button = sliceOf(
      mock,
      pageOf(mock),
      { x: 0, y: 0, width: 256, height: 128 },
      [24, 20, 16, 12]
    );

    mock.api.sync.textures.provide(key => (key === "ui.button" ? button : undefined) as never);

    const entity = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform(),
      NineSlice({ texture: "ui.button", width: 400, height: 128 })
    ]);

    mock.modules.sync.pass();

    const object = mock.ctx.state.sync.views.get(entity)?.object as unknown as Record<
      string,
      unknown
    >;

    expect(object.texture).toBe(button);
    expect([object.leftWidth, object.topHeight, object.rightWidth, object.bottomHeight]).toEqual([
      24, 20, 16, 12
    ]);
  });

  it("crops a cover sprite on a slice inside the slice's frame", async () => {
    const mock = await started();
    const page = pageOf(mock);
    const meadow = sliceOf(mock, page, { x: 100, y: 50, width: 200, height: 100 });

    mock.api.sync.textures.provide(() => meadow as never);

    const entity = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform(),
      Sprite({ texture: "board.bg", width: 100, height: 100, fit: "cover" })
    ]);

    mock.modules.sync.pass();

    const object = mock.ctx.state.sync.views.get(entity)?.object as unknown as FakeSprite;

    expect(object.texture.source).toBe(page.source);
    expect({ ...object.texture.frame }).toEqual({ x: 150, y: 50, width: 100, height: 100 });
  });

  it("frees only the wrapper of a slice, and the crops cut from it", async () => {
    const mock = await started();
    const page = pageOf(mock);
    const meadow = sliceOf(mock, page, { x: 100, y: 50, width: 200, height: 100 });

    mock.api.sync.textures.provide(() => meadow as never);
    mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform(),
      Sprite({ texture: "board.bg", width: 100, height: 100, fit: "cover" })
    ]);
    mock.modules.sync.pass();

    const crop = [...mock.ctx.state.sync.frames.values()][0]?.texture as unknown as FakeTexture;

    mock.api.sync.textures.destroy(meadow as never);

    expect(meadow.destroyed).toBe(true);
    expect(meadow.destroyedSource).toBe(false);
    expect(crop.destroyed).toBe(true);
    expect(crop.destroyedSource).toBe(false);
    expect(mock.ctx.state.sync.frames.size).toBe(0);
    expect(page.source.destroyed).toBe(false);
    expect(page.destroyed).toBe(false);
  });

  it("frees a slice once, however often it is asked", async () => {
    const mock = await started();
    const slice = sliceOf(mock, pageOf(mock), { x: 0, y: 0, width: 32, height: 32 });

    mock.api.sync.textures.destroy(slice as never);
    mock.api.sync.textures.destroy(slice as never);

    expect(slice.destroyCalls).toBe(1);
    expect(slice.source.destroyed).toBe(false);
    // The source stays with the page, so its listeners stay too.
    expect(slice.source.released).toEqual([]);
  });

  it("frees the source with the page, and a slice after it never asks for the source again", async () => {
    const mock = await started();
    const page = pageOf(mock);
    const slice = sliceOf(mock, page, { x: 0, y: 0, width: 32, height: 32 });

    mock.api.sync.textures.destroy(page as never);

    expect(page.destroyedSource).toBe(true);
    expect(page.source.destroyed).toBe(true);
    expect(() => mock.api.sync.textures.destroy(slice as never)).not.toThrow();
    expect(slice.destroyedSource).toBe(false);

    mock.api.sync.textures.destroy(slice as never);

    expect(slice.destroyCalls).toBe(1);
  });

  it("refuses a frame outside the page, which a stale manifest names", async () => {
    const mock = await started();
    const page = pageOf(mock);

    expect(() => sliceOf(mock, page, { x: 300, y: 0, width: 256, height: 128 })).toThrow(
      '[game] renderer.sync.textures.slice: frame 300,0 256x128 is outside page 512x512.\n  Run "bun run assets:pack".'
    );
    expect(() => sliceOf(mock, page, { x: 0, y: 400, width: 256, height: 128 })).toThrow(
      "frame 0,400 256x128 is outside page 512x512."
    );
    expect(() => sliceOf(mock, page, { x: -1, y: 0, width: 8, height: 8 })).toThrow(
      "frame -1,0 8x8 is outside page 512x512."
    );
    expect(() => sliceOf(mock, page, { x: 0, y: 0, width: 8, height: -8 })).toThrow(
      "frame 0,0 8x-8 is outside page 512x512."
    );
    expect(() => sliceOf(mock, page, { x: 256, y: 384, width: 256, height: 128 })).not.toThrow();
  });

  it("measures the page by its own frame, not by its source", async () => {
    const mock = await started();
    const page = new FakeTexture({
      source: { width: 512, height: 512, destroyed: false },
      frame: new FakeRectangle(0, 0, 128, 128)
    });

    expect(() => sliceOf(mock, page, { x: 64, y: 0, width: 128, height: 64 })).toThrow(
      "frame 64,0 128x64 is outside page 128x128."
    );
  });

  it("refuses to slice while the device is lost", async () => {
    const mock = await started();
    const page = pageOf(mock);

    mock.ctx.state.host.ready = false;

    expect(() => sliceOf(mock, page, { x: 0, y: 0, width: 8, height: 8 })).toThrow(
      "[game] renderer.sync.textures.slice needs a ready renderer.\n  Check app.renderer.host.ready() first."
    );
  });

  it("refuses to slice while inert", () => {
    const mock = createMockRenderer({ dom: false });
    const page = new FakeTexture({});

    expect(() => sliceOf(mock, page, { x: 0, y: 0, width: 8, height: 8 })).toThrow(
      "[game] renderer.sync.textures.slice needs a ready renderer."
    );
  });
});
