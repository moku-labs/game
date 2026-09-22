import { describe, expect, it } from "vitest";
import { component, Layer } from "../../ecs/define";
import type { AnyComponentValue } from "../../ecs/types";
import { deepEquals, diffComponents } from "../../projection/diff";
import { BOARD, commitItems, Level, mountBoard, storedOf, Transform } from "./board";
import { createMockWorld } from "./mock-world";

const Bobbing = component("Bobbing", { amplitude: 4 });

describe("projection diff", () => {
  it("compares plain JSON structurally, not by identity", () => {
    expect(deepEquals({ x: 1, y: [2, 3] }, { x: 1, y: [2, 3] })).toBe(true);
    expect(deepEquals({ x: 1 }, { x: 2 })).toBe(false);
    expect(deepEquals({ x: 1 }, { x: 1, y: 0 })).toBe(false);
    expect(deepEquals([1, 2], [1])).toBe(false);
    expect(deepEquals(true, true)).toBe(true);
  });

  it("names added, changed and removed components", () => {
    const rest = new Map<string, AnyComponentValue>([
      ["Level", Level({ level: 1 })],
      ["Transform", Transform()]
    ]);
    const next = new Map<string, AnyComponentValue>([
      ["Level", Level({ level: 2 })],
      ["Bobbing", Bobbing({ amplitude: 4 })]
    ]);

    expect(diffComponents(rest, next)).toEqual({
      added: ["Bobbing"],
      changed: ["Level"],
      removed: ["Transform"]
    });
  });

  it("writes a changed component directly when no hook owns it", () => {
    const world = createMockWorld();

    mountBoard(world, [{ id: "a", level: 1, x: 0, y: 0 }]);
    commitItems(world, [{ id: "a", level: 2, x: 40, y: 0 }]);
    world.frame();

    const entity = world.api.projection.entityOf(BOARD, "a");

    expect(world.api.ecs.get(entity ?? 0, Level)).toEqual({ level: 2 });
    expect(world.api.ecs.get(entity ?? 0, Transform)).toEqual({ x: 40, y: 0, scale: 1 });
  });

  it("never reads, writes or removes a component the view did not return", () => {
    const world = createMockWorld();

    mountBoard(world, [{ id: "a", level: 1, x: 0, y: 0 }]);

    const entity = world.api.projection.entityOf(BOARD, "a") ?? 0;

    world.api.ecs.add(entity, Bobbing({ amplitude: 9 }));
    commitItems(world, [{ id: "a", level: 2, x: 0, y: 0 }]);
    world.frame();

    expect(world.api.ecs.get(entity, Bobbing)).toEqual({ amplitude: 9 });
  });

  it("removes a component that disappeared from the view", () => {
    const world = createMockWorld();
    let withTransform = true;

    world.model.player = { items: [{ id: "a", level: 1, x: 0, y: 0 }] };
    world.api.projection.setLayers([
      { name: "board", sort: "none" },
      { name: "items", sort: "y" }
    ]);
    world.api.projection.register({
      name: BOARD,
      layer: "items",
      from: (player: { items: { id: string; level: number }[] }) => player.items,
      key: (item: { id: string; level: number }) => item.id,
      view: (item: { id: string; level: number }) =>
        withTransform ? [Level({ level: item.level }), Transform()] : [Level({ level: item.level })]
    });
    world.start();
    world.api.projection.mount([BOARD], { kind: "plugin", name: "test" });

    const entity = world.api.projection.entityOf(BOARD, "a") ?? 0;

    expect(world.api.ecs.has(entity, Transform)).toBe(true);

    withTransform = false;
    commitItems(world, [{ id: "a", level: 2, x: 0, y: 0 }]);
    world.frame();

    expect(world.api.ecs.has(entity, Transform)).toBe(false);
  });

  it("refuses a Layer value from the view and keeps the projection's own layer", () => {
    const world = createMockWorld();

    world.model.player = { items: [{ id: "a" }] };
    world.api.projection.setLayers([
      { name: "board", sort: "none" },
      { name: "items", sort: "y" }
    ]);
    world.api.projection.register({
      name: BOARD,
      layer: "items",
      from: (player: { items: { id: string }[] }) => player.items,
      key: (item: { id: string }) => item.id,
      view: () => [Layer({ name: "board" })]
    });
    world.start();
    world.api.projection.mount([BOARD], { kind: "plugin", name: "test" });

    const entity = world.api.projection.entityOf(BOARD, "a") ?? 0;

    expect(storedOf(world, entity, "Layer")).toEqual({ name: "items" });
    expect(world.log.warn).toHaveBeenCalled();
  });
});
