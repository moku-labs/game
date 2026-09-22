import { describe, expect, expectTypeOf, it } from "vitest";
import { projection } from "../../projection/define";
import { BOARD, boardItems, LAYERS, MOUNT_OWNER, mountBoard } from "./board";
import { createMockWorld } from "./mock-world";

describe("projection/define", () => {
  it("returns the same spec and keeps the layer names literal", () => {
    const spec = projection({
      name: BOARD,
      layer: "items",
      lift: "lifted",
      from: (player: { items: { id: string }[] }) => player.items,
      key: item => item.id,
      view: () => []
    });

    expect(spec.name).toBe(BOARD);
    expectTypeOf(spec.layer).toEqualTypeOf<"items">();
    expectTypeOf(spec.lift).toEqualTypeOf<"lifted" | undefined>();
  });

  it("refuses a duplicate projection name", () => {
    const world = createMockWorld();

    world.api.projection.register(boardItems());

    expect(() => world.api.projection.register(boardItems())).toThrow("[game]");
  });

  it("stores a new frozen array on every setLayers and starts empty", () => {
    const world = createMockWorld();

    expect(world.api.projection.layers()).toEqual([]);

    world.api.projection.setLayers(LAYERS);

    const first = world.api.projection.layers();

    world.api.projection.setLayers(LAYERS);

    expect(world.api.projection.layers()).not.toBe(first);
    expect(Object.isFrozen(world.api.projection.layers())).toBe(true);
  });

  it("throws for an unknown projection name and mounts nothing", () => {
    const world = createMockWorld();

    world.api.projection.setLayers(LAYERS);
    world.api.projection.register(boardItems());

    expect(() => world.api.projection.mount([BOARD, "missing"], MOUNT_OWNER)).toThrow("[game]");
    expect(world.api.projection.entityOf(BOARD, "a")).toBeUndefined();
  });

  it("throws for a layer the scene does not declare and mounts nothing", () => {
    const world = createMockWorld();

    world.model.player = { items: [{ id: "a", level: 1, x: 0, y: 0 }] };
    world.api.projection.setLayers([{ name: "board", sort: "none" }]);
    world.api.projection.register(boardItems());

    expect(() => world.api.projection.mount([BOARD], MOUNT_OWNER)).toThrow(
      '[game] Projection "board.items" names layer "items", which the scene does not declare.\n  Add it to the layers of the scene.'
    );
    expect(world.api.projection.entityOf(BOARD, "a")).toBeUndefined();
  });

  it("throws for a lift layer the scene does not declare", () => {
    const world = createMockWorld();

    world.api.projection.setLayers([
      { name: "board", sort: "none" },
      { name: "items", sort: "y" }
    ]);
    world.api.projection.register(boardItems());

    expect(() => world.api.projection.mount([BOARD], MOUNT_OWNER)).toThrow('names layer "lifted"');
  });

  it("warns and does nothing when a projection is mounted twice", () => {
    const world = createMockWorld();

    mountBoard(world, [{ id: "a", level: 1, x: 0, y: 0 }]);
    world.api.projection.mount([BOARD], MOUNT_OWNER);

    expect(world.log.warn).toHaveBeenCalled();
  });
});
