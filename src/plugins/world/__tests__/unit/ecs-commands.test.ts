import { describe, expect, it } from "vitest";
import { component, system, tag } from "../../ecs/define";
import type { Entity, Owner } from "../../ecs/types";
import { createMockWorld } from "./mock-world";

const Marker = component("Marker", { at: 0 });
const Held = tag("Held");
const test: Owner = { kind: "plugin", name: "test" };

describe("ecs command buffer", () => {
  it("applies a structural change at once outside a phase", () => {
    const world = createMockWorld();
    const entity = world.api.ecs.spawn(test, []);

    world.api.ecs.tag(entity, Held);

    expect(world.api.ecs.has(entity, Held)).toBe(true);
  });

  it("queues structural changes inside a phase and applies them in call order", () => {
    const world = createMockWorld();
    const entity = world.api.ecs.spawn(test, [Marker({ at: 1 })]);
    const seen: boolean[] = [];

    world.api.ecs.system(
      system({
        name: "structural",
        phase: "input",
        query: [Marker],
        run: (entities, ctx) => {
          for (const [found] of entities) {
            ctx.world.tag(found, Held);
            seen.push(ctx.world.has(found, Held));
            ctx.world.untag(found, Held);
          }
        }
      })
    );
    world.start();
    world.frame();

    expect(seen).toEqual([false]);
    expect(world.api.ecs.has(entity, Held)).toBe(false);
  });

  it("gives a valid id at once for a spawn inside a phase", () => {
    const world = createMockWorld();
    const spawned: Entity[] = [];

    world.api.ecs.spawn(test, [Marker({ at: 1 })]);
    world.api.ecs.system(
      system({
        name: "spawner",
        phase: "input",
        query: [Marker],
        run: (entities, ctx) => {
          for (const [found] of entities) {
            if (spawned.length > 0) return;
            const fresh = ctx.world.spawn(test, [Marker({ at: 2 })]);

            spawned.push(fresh, found);
          }
        }
      })
    );
    world.start();
    world.frame();

    const fresh = spawned[0] as Entity;

    expect(Number.isSafeInteger(fresh)).toBe(true);
    expect(world.api.ecs.get(fresh, Marker)).toEqual({ at: 2 });
  });

  it("drops a queued command whose target died meanwhile", () => {
    const world = createMockWorld();
    const entity = world.api.ecs.spawn(test, [Marker({ at: 1 })]);

    world.api.ecs.system(
      system({
        name: "killer",
        phase: "input",
        query: [Marker],
        run: (entities, ctx) => {
          for (const [found] of entities) {
            ctx.world.despawn(found);
            ctx.world.tag(found, Held);
          }
        }
      })
    );
    world.start();

    expect(() => world.frame()).not.toThrow();
    expect(world.api.ecs.has(entity, Held)).toBe(false);
    expect(world.api.ecs.has(entity, Marker)).toBe(false);
  });

  it("never queues set: a later system of the phase sees the write", () => {
    const world = createMockWorld();
    const entity = world.api.ecs.spawn(test, [Marker({ at: 1 })]);
    const seen: number[] = [];

    world.api.ecs.system(
      system({
        name: "writer",
        phase: "input",
        query: [Marker],
        run: (entities, ctx) => {
          for (const [found] of entities) ctx.world.set(found, Marker, { at: 7 });
        }
      })
    );
    world.api.ecs.system(
      system({
        name: "reader",
        phase: "input",
        query: [Marker],
        run: entities => {
          for (const [, marker] of entities) seen.push(marker.at);
        }
      })
    );
    world.start();
    world.frame();

    expect(seen).toEqual([7]);
    expect(world.api.ecs.get(entity, Marker)).toEqual({ at: 7 });
  });
});
