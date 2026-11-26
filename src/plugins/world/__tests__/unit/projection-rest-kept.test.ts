import { describe, expect, it } from "vitest";
import type { Entity, Owner } from "../../ecs/types";
import { mountBoard, Transform } from "./board";
import type { MockWorld } from "./mock-world";
import { createMockWorld } from "./mock-world";

// ---------------------------------------------------------------------------
// Unit test: the rest pose an owner records, written in place (change 2026-11-26-f244-peek-pool, slice 1). What a
// hook or a game reads of it is a frozen value that keeps its fields; the handle `viewOf` keeps per element still
// asks the sweep to walk, as a new one did.
// ---------------------------------------------------------------------------

/** The plugin that owns the element, as `ui` does. */
const OWNER: Owner = { kind: "plugin", name: "ui" };

/**
 * Starts the world with an empty board and spawns one element `ui` owns, its rest `Transform` recorded.
 *
 * @param world - The mock world.
 * @returns The element's entity.
 */
function spawnElement(world: MockWorld): Entity {
  mountBoard(world, []);

  const entity = world.api.ecs.spawn(OWNER, [Transform({ x: 10, y: 20, scale: 1 })]);

  world.api.projection.setRest(entity, Transform, { x: 10, y: 20, scale: 1 });

  return entity;
}

describe("projection setRest — a kept record, read through a frozen value", () => {
  it("hands out the same frozen value for two reads with no setRest between, and a new one after", () => {
    // Bug caught: a read that hands out the record written in place, or a new object per read.
    const world = createMockWorld();
    const entity = spawnElement(world);
    const view = world.api.projection.viewOf(entity, OWNER);
    const first = view?.rest(Transform);

    expect(view?.rest(Transform)).toBe(first);
    expect(Object.isFrozen(first)).toBe(true);
    expect(world.api.projection.restOf(entity, Transform)).toBe(first);

    world.api.projection.setRest(entity, Transform, { x: 30, y: 20, scale: 1 });

    const second = view?.rest(Transform);

    expect(second).not.toBe(first);
    expect(second).toMatchObject({ x: 30, y: 20 });
    expect(Object.isFrozen(second)).toBe(true);
  });

  it("keeps a value a hook held as it was after the next setRest", () => {
    // Bug caught: the held value is the record itself, and the next rest moves it under the hook.
    const world = createMockWorld();
    const entity = spawnElement(world);
    const held = world.api.projection.viewOf(entity, OWNER)?.rest(Transform);

    world.api.projection.setRest(entity, Transform, { x: 99, y: 98, scale: 2 });

    expect(held).toMatchObject({ x: 10, y: 20, scale: 1 });
    expect(world.api.projection.restOf(entity, Transform)).toMatchObject({
      x: 99,
      y: 98,
      scale: 2
    });
  });

  it("brings a hookless rest move of an element home through the kept handle, frame by frame", () => {
    // Bug caught: the kept handle writes the rest it was made with, not the one recorded since.
    const world = createMockWorld();
    const entity = spawnElement(world);

    world.api.projection.viewOf(entity, OWNER)?.toRest(Transform, { ms: 0 });
    world.api.projection.setRest(entity, Transform, { x: 40, y: 50, scale: 1 });
    world.api.projection.viewOf(entity, OWNER)?.toRest(Transform, { ms: 0 });
    world.frame(16);

    expect(world.api.ecs.get(entity, Transform)).toMatchObject({ x: 40, y: 50, scale: 1 });
  });
});
