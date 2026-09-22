import { describe, expect, it } from "vitest";
import { component } from "../../ecs/define";
import type { Owner } from "../../ecs/types";
import { createMockWorld } from "./mock-world";

const Transform = component("Transform", { x: 0, y: 0 });
const test: Owner = { kind: "plugin", name: "test" };
const other: Owner = { kind: "node", name: "reward" };

describe("ecs entities", () => {
  it("hands out an id of generation 1 for a fresh index", () => {
    const world = createMockWorld();
    const entity = world.api.ecs.spawn(test, [Transform()]);

    expect(entity).toBe(2 ** 20);
  });

  it("bumps the generation when a freed index comes back", () => {
    const world = createMockWorld();
    const first = world.api.ecs.spawn(test, [Transform()]);

    world.api.ecs.despawn(first);

    const second = world.api.ecs.spawn(test, [Transform()]);

    expect(second).toBe(2 * 2 ** 20);
    expect(second).not.toBe(first);
  });

  it("reads undefined and writes nothing through a stale id", () => {
    const world = createMockWorld();
    const entity = world.api.ecs.spawn(test, [Transform({ x: 5 })]);

    world.api.ecs.despawn(entity);

    expect(world.api.ecs.get(entity, Transform)).toBeUndefined();
    expect(world.api.ecs.has(entity, Transform)).toBe(false);
    expect(() => world.api.ecs.despawn(entity)).not.toThrow();
    expect(() => world.api.ecs.set(entity, Transform, { x: 1 })).toThrow("[game]");
  });

  it("despawns exactly the entities of one owner", () => {
    const world = createMockWorld();
    const mine = world.api.ecs.spawn(test, [Transform()]);
    const theirs = world.api.ecs.spawn(other, [Transform()]);

    world.api.ecs.despawnOwnedBy(test);

    expect(world.api.ecs.has(mine, Transform)).toBe(false);
    expect(world.api.ecs.has(theirs, Transform)).toBe(true);
  });

  it("names the owner of every entity in the snapshot", () => {
    const world = createMockWorld();

    world.api.ecs.spawn(other, [Transform()]);

    const snapshot = world.api.ecs.snapshot() as {
      entities: Array<{ owner: Owner; index: number; generation: number }>;
    };

    expect(snapshot.entities[0]?.owner).toEqual(other);
    expect(snapshot.entities[0]?.index).toBe(0);
    expect(snapshot.entities[0]?.generation).toBe(1);
  });
});
