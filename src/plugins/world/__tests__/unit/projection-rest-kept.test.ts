import { describe, expect, it } from "vitest";
import type { Entity, Owner } from "../../ecs/types";
import type { TrackOptions, TweenDriver } from "../../projection/types";
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

  it("asks the sweep to walk again when a quiet sweep came between two rest moves through the kept handle", () => {
    // Bug caught: the kept handle is handed back before `viewOf` marks the world moving, so after one quiet sweep a
    // hookless rest move is never swept: no live view is settled while its track ends.
    const world = createMockWorld();
    const entity = spawnElement(world);
    const projection = world.ctx.state.projection;
    const first = world.api.projection.viewOf(entity, OWNER);

    first?.toRest(Transform, { ms: 0 });
    world.frame(16);
    world.frame(16);

    expect(projection.moving).toBe(false);

    world.api.projection.setRest(entity, Transform, { x: 70, y: 20, scale: 1 });
    const again = world.api.projection.viewOf(entity, OWNER);

    expect(again).toBe(first);
    expect(projection.moving).toBe(true);
    again?.toRest(Transform, { ms: 0 });
    world.frame(16);

    expect(world.api.ecs.get(entity, Transform)).toMatchObject({ x: 70, y: 20 });
  });

  it("hands a driver a game sets a target, options and muted reader of its own, kept as they were", () => {
    // Bug caught: a rest move hands a driver the projection's kept records, and a later rest move, once the first track
    // ended, writes another entity's target into the object the driver still holds.
    const world = createMockWorld();
    const first = spawnElement(world);
    const second = world.api.ecs.spawn(OWNER, [Transform({ x: 0, y: 0, scale: 1 })]);
    const handed: Array<{
      to: Record<string, number>;
      options: TrackOptions;
      muted: () => unknown;
    }> = [];
    const driver: TweenDriver = {
      track: (_entity, _component, to, options, muted) => {
        handed.push({ to, options, muted });

        return { finish: () => undefined, cancel: () => undefined, active: () => false };
      },
      cancelAll: () => undefined
    };

    world.api.projection.setRest(second, Transform, { x: 5, y: 6, scale: 1 });
    world.api.projection.setDriver(driver);
    world.api.projection.viewOf(first, OWNER)?.toRest(Transform, { ms: 0 });
    world.frame(16);
    world.api.projection.viewOf(second, OWNER)?.toRest(Transform, { ms: 0 });

    expect(handed).toHaveLength(2);
    expect(handed[0]?.to).toMatchObject({ x: 10, y: 20 });
    expect(handed[1]?.to).toMatchObject({ x: 5, y: 6 });
    expect(handed[0]?.to).not.toBe(handed[1]?.to);
    expect(handed[0]?.options).not.toBe(handed[1]?.options);
    expect(handed[0]?.muted).not.toBe(handed[1]?.muted);
  });
});
