import { describe, expect, it } from "vitest";
import { projection } from "../../projection/define";
import type { AnyProjectionSpec } from "../../projection/types";
import type { Item, Player } from "./board";
import { BOARD, boardItems, LAYERS, Level, MOUNT_OWNER, mountBoard, Transform } from "./board";
import { createMockWorld } from "./mock-world";

/**
 * Builds a board projection whose view writes one fixed level, so a test sees which spec ran.
 *
 * @param level - The level every view writes.
 * @param layer - The layer the projection draws on.
 * @returns The projection spec, named like the fixture.
 */
function fixedLevel(level: number, layer = "items"): AnyProjectionSpec {
  return projection({
    name: BOARD,
    layer,
    from: (player: Player) => player.items,
    key: (item: Item) => item.id,
    view: (item: Item) => [Level({ level }), Transform({ x: item.x, y: item.y, scale: 1 })]
  }) as AnyProjectionSpec;
}

describe("projection.replace", () => {
  it("runs the new view for every item of a mounted projection on the next frame", () => {
    const world = createMockWorld();

    mountBoard(world, [{ id: "a", level: 1, x: 0, y: 0 }]);
    const entity = world.api.projection.entityOf(BOARD, "a") ?? 0;

    world.api.projection.replace(fixedLevel(9));
    expect(world.api.ecs.get(entity, Level)).toEqual({ level: 1 });

    world.frame();

    expect(world.api.projection.entityOf(BOARD, "a")).toBe(entity);
    expect(world.api.ecs.get(entity, Level)).toEqual({ level: 9 });
  });

  it("throws for a name that is not registered", () => {
    const world = createMockWorld();

    expect(() => world.api.projection.replace(boardItems())).toThrow(
      `[game] Projection "${BOARD}" is not registered.\n  Register it before replacing it.`
    );
  });

  it("only stores the spec of an unmounted projection, and a later mount uses it", () => {
    const world = createMockWorld();

    world.model.player = { items: [{ id: "a", level: 1, x: 0, y: 0 }] };
    world.api.projection.setLayers(LAYERS);
    world.api.projection.register(boardItems());
    world.start();

    world.api.projection.replace(fixedLevel(4, "nowhere"));
    world.api.projection.replace(fixedLevel(4));
    world.frame();
    expect(world.api.projection.entityOf(BOARD, "a")).toBeUndefined();

    world.api.projection.mount([BOARD], MOUNT_OWNER);
    const entity = world.api.projection.entityOf(BOARD, "a") ?? 0;

    expect(world.api.ecs.get(entity, Level)).toEqual({ level: 4 });
  });

  it("throws for a layer the scene does not declare and keeps the old spec", () => {
    const world = createMockWorld();

    mountBoard(world, [{ id: "a", level: 2, x: 0, y: 0 }]);
    const entity = world.api.projection.entityOf(BOARD, "a") ?? 0;

    expect(() => world.api.projection.replace(fixedLevel(9, "nowhere"))).toThrow(
      `[game] Projection "${BOARD}" names layer "nowhere", which the scene does not declare.\n` +
        "  Add it to the layers of the scene."
    );

    world.api.projection.rerunAll();
    world.frame();

    expect(world.api.ecs.get(entity, Level)).toEqual({ level: 2 });
  });
});
