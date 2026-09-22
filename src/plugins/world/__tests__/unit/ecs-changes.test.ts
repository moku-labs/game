import { describe, expect, it, vi } from "vitest";
import { component, mut, system } from "../../ecs/define";
import type { Owner } from "../../ecs/types";
import { createMockWorld } from "./mock-world";

const Position = component("Position", { x: 0, y: 0 });
const Sprite = component("Sprite", { texture: "" });
const test: Owner = { kind: "plugin", name: "test" };

describe("ecs change detection", () => {
  it("marks a mut query and a set, and clears the sets in the signals phase", () => {
    const world = createMockWorld();
    const entity = world.api.ecs.spawn(test, [Position()]);
    const seen: number[][] = [];

    world.api.ecs.system(
      system({
        name: "mover",
        phase: "input",
        query: [mut(Position)],
        run: entities => {
          for (const [, position] of entities) position.x += 1;
        }
      })
    );
    world.api.ecs.system(
      system({
        name: "watcher",
        phase: "sync",
        query: [Position],
        run: (_entities, ctx) => {
          seen.push([...ctx.world.changed(Position)]);
        }
      })
    );
    world.start();
    world.frame();

    expect(seen).toEqual([[entity]]);
    expect([...world.api.ecs.changed(Position)]).toEqual([]);
  });

  it("marks an entity changed on set and on a replacing add", () => {
    const world = createMockWorld();
    const entity = world.api.ecs.spawn(test, [Position()]);

    world.api.ecs.set(entity, Position, { x: 3 });
    expect([...world.api.ecs.changed(Position)]).toEqual([entity]);

    world.api.ecs.add(entity, Sprite({ texture: "a" }));
    expect([...world.api.ecs.changed(Sprite)]).toEqual([entity]);
  });

  it("drops a despawned entity from every change set", () => {
    const world = createMockWorld();
    const entity = world.api.ecs.spawn(test, [Position()]);

    world.api.ecs.set(entity, Position, { x: 3 });
    world.api.ecs.despawn(entity);

    expect([...world.api.ecs.changed(Position)]).toEqual([]);
  });

  it("fires the structural hooks when a queued command is applied, not when it is made", () => {
    const world = createMockWorld();
    const added = vi.fn();

    world.api.ecs.onAdded(Sprite, added);
    world.api.ecs.spawn(test, [Position()]);
    world.api.ecs.system(
      system({
        name: "adder",
        phase: "input",
        query: [Position],
        run: (entities, ctx) => {
          for (const [entity] of entities) {
            if (ctx.world.has(entity, Sprite)) return;
            ctx.world.add(entity, Sprite({ texture: "a" }));
            expect(added).not.toHaveBeenCalled();
          }
        }
      })
    );
    world.start();
    world.frame();

    expect(added).toHaveBeenCalledTimes(1);
  });
});
