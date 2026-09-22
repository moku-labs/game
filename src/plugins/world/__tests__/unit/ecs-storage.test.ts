import { describe, expect, it, vi } from "vitest";
import { component, tag } from "../../ecs/define";
import type { Owner } from "../../ecs/types";
import { createMockWorld } from "./mock-world";

const Transform = component("Transform", { x: 0, y: 0 });
const Sprite = component("Sprite", { texture: "" });
const Held = tag("Held");
const test: Owner = { kind: "plugin", name: "test" };

describe("ecs storage", () => {
  it("reads, merges and replaces component values", () => {
    const world = createMockWorld();
    const entity = world.api.ecs.spawn(test, [Transform({ x: 1, y: 2 })]);

    expect(world.api.ecs.get(entity, Transform)).toEqual({ x: 1, y: 2 });

    world.api.ecs.set(entity, Transform, { x: 9 });
    expect(world.api.ecs.get(entity, Transform)).toEqual({ x: 9, y: 2 });

    world.api.ecs.add(entity, Transform({ x: 4 }));
    expect(world.api.ecs.get(entity, Transform)).toEqual({ x: 4, y: 0 });
  });

  it("throws when set meets an entity without the component", () => {
    const world = createMockWorld();
    const entity = world.api.ecs.spawn(test, []);

    expect(() => world.api.ecs.set(entity, Transform, { x: 1 })).toThrow("[game]");
  });

  it("adds and removes components and tags", () => {
    const world = createMockWorld();
    const entity = world.api.ecs.spawn(test, []);

    world.api.ecs.add(entity, Sprite({ texture: "item" }));
    expect(world.api.ecs.has(entity, Sprite)).toBe(true);

    world.api.ecs.remove(entity, Sprite);
    expect(world.api.ecs.has(entity, Sprite)).toBe(false);

    world.api.ecs.tag(entity, Held);
    world.api.ecs.tag(entity, Held);
    expect(world.api.ecs.has(entity, Held)).toBe(true);

    world.api.ecs.untag(entity, Held);
    world.api.ecs.untag(entity, Held);
    expect(world.api.ecs.has(entity, Held)).toBe(false);
  });

  it("fires onAdded and onRemoved once, and not on a replacing add", () => {
    const world = createMockWorld();
    const added = vi.fn();
    const removed = vi.fn();

    world.api.ecs.onAdded(Sprite, added);
    world.api.ecs.onRemoved(Sprite, removed);

    const entity = world.api.ecs.spawn(test, [Sprite({ texture: "a" })]);

    expect(added).toHaveBeenCalledWith(entity, { texture: "a" });

    world.api.ecs.add(entity, Sprite({ texture: "b" }));
    expect(added).toHaveBeenCalledTimes(1);

    world.api.ecs.remove(entity, Sprite);
    expect(removed).toHaveBeenCalledWith(entity, { texture: "b" });
  });

  it("logs a throwing structural hook and still runs the others", () => {
    const world = createMockWorld();
    const second = vi.fn();

    world.api.ecs.onAdded(Sprite, () => {
      throw new Error("boom");
    });
    world.api.ecs.onAdded(Sprite, second);

    world.api.ecs.spawn(test, [Sprite({ texture: "a" })]);

    expect(second).toHaveBeenCalledTimes(1);
    expect(world.log.error).toHaveBeenCalled();
  });

  it("removes every component of a despawned entity through onRemoved", () => {
    const world = createMockWorld();
    const removed = vi.fn();

    world.api.ecs.onRemoved(Sprite, removed);

    const entity = world.api.ecs.spawn(test, [Sprite({ texture: "a" }), Transform()]);

    world.api.ecs.despawn(entity);

    expect(removed).toHaveBeenCalledWith(entity, { texture: "a" });
  });

  it("drops the remover of a structural hook idempotently", () => {
    const world = createMockWorld();
    const added = vi.fn();
    const off = world.api.ecs.onAdded(Sprite, added);

    off();
    off();
    world.api.ecs.spawn(test, [Sprite({ texture: "a" })]);

    expect(added).not.toHaveBeenCalled();
  });

  it("answers a component type by its name once the world knows it", () => {
    const world = createMockWorld();

    expect(world.api.ecs.typeOf("Sprite")).toBeUndefined();

    const entity = world.api.ecs.spawn(test, [Sprite({ texture: "a" })]);
    const type = world.api.ecs.typeOf("Sprite");

    expect(type).toBe(Sprite);
    expect(type === undefined ? undefined : world.api.ecs.get(entity, type)).toEqual({
      texture: "a"
    });
  });

  it("answers a tag by its name and undefined for a name nobody used", () => {
    const world = createMockWorld();

    world.api.ecs.tag(world.api.ecs.spawn(test, []), Held);

    expect(world.api.ecs.typeOf("Held")?.componentName).toBe("Held");
    expect(world.api.ecs.typeOf("Nothing")).toBeUndefined();
  });
});
