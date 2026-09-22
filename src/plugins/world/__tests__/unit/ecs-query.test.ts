import { describe, expect, it } from "vitest";
import { component, mut, tag } from "../../ecs/define";
import type { Entity, Owner } from "../../ecs/types";
import { createMockWorld } from "./mock-world";

const Position = component("Position", { x: 0, y: 0 });
const Sprite = component("Sprite", { texture: "" });
const Held = tag("Held");
const test: Owner = { kind: "plugin", name: "test" };

describe("ecs query", () => {
  it("walks the store of the first term in insertion order", () => {
    const world = createMockWorld();
    const first = world.api.ecs.spawn(test, [Sprite({ texture: "a" }), Position()]);
    const second = world.api.ecs.spawn(test, [Position({ x: 2 })]);
    const third = world.api.ecs.spawn(test, [Sprite({ texture: "c" }), Position({ x: 3 })]);

    const bySprite = [...world.api.ecs.query(Sprite, Position)].map(([entity]) => entity);
    const byPosition = [...world.api.ecs.query(Position)].map(([entity]) => entity);

    expect(bySprite).toEqual([first, third]);
    expect(byPosition).toEqual([first, second, third]);
  });

  it("yields true for a tag term and keeps only tagged entities", () => {
    const world = createMockWorld();
    const tagged = world.api.ecs.spawn(test, [Position()]);

    world.api.ecs.spawn(test, [Position()]);
    world.api.ecs.tag(tagged, Held);

    const rows = [...world.api.ecs.query(Position, Held)];

    expect(rows).toEqual([[tagged, { x: 0, y: 0 }, true]]);
  });

  it("marks every yielded entity changed for a mut term", () => {
    const world = createMockWorld();
    const entity: Entity = world.api.ecs.spawn(test, [Position()]);

    world.start();
    world.frame();
    expect([...world.api.ecs.changed(Position)]).toEqual([]);

    for (const [, position] of world.api.ecs.query(mut(Position))) position.x += 1;

    expect([...world.api.ecs.changed(Position)]).toEqual([entity]);
    expect(world.api.ecs.get(entity, Position)).toEqual({ x: 1, y: 0 });
  });

  it("keeps walking when the loop despawns the entity it was handed", () => {
    const world = createMockWorld();
    const first = world.api.ecs.spawn(test, [Position()]);
    const second = world.api.ecs.spawn(test, [Position()]);
    const third = world.api.ecs.spawn(test, [Position()]);
    const seen: Entity[] = [];

    for (const [entity] of world.api.ecs.query(Position)) {
      seen.push(entity);
      world.api.ecs.despawn(entity);
    }

    expect(seen).toEqual([first, second, third]);
    expect([...world.api.ecs.query(Position)]).toEqual([]);
  });

  it("yields nothing when the first term was never stored", () => {
    const world = createMockWorld();

    world.api.ecs.spawn(test, [Position()]);

    expect([...world.api.ecs.query(Sprite)]).toEqual([]);
  });
});
