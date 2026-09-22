import { describe, expect, it } from "vitest";
import { component, Exiting, Layer, mut, Order, resource, system, tag } from "../../ecs/define";
import { createMockWorld } from "./mock-world";

const Item = component("Item", { kind: "", level: 1 });
const Held = tag("Held");
const Pointer = resource("Pointer", { x: 0, y: 0, down: false });

describe("ecs/define", () => {
  it("fills the defaults of a component and keeps the name as the storage key", () => {
    expect(Item({ level: 2 })).toEqual({ type: Item, value: { kind: "", level: 2 } });
    expect(Item()).toEqual({ type: Item, value: { kind: "", level: 1 } });
    expect(Item.componentName).toBe("Item");
  });

  it("freezes the value and the defaults, so a game cannot write through them", () => {
    const value = Item({ level: 3 });

    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(value.value)).toBe(true);
    expect(Object.isFrozen(Item.defaults)).toBe(true);
  });

  it("stores a tag as true", () => {
    expect(Held()).toEqual({ type: Held, value: true });
    expect(Held.kind).toBe("tag");
  });

  it("keeps the resource defaults", () => {
    expect(Pointer.resourceName).toBe("Pointer");
    expect(Pointer.defaults).toEqual({ x: 0, y: 0, down: false });
  });

  it("marks a term as written", () => {
    expect(mut(Item)).toEqual({ kind: "mut", of: Item });
  });

  it("returns the same system object", () => {
    const definition = { name: "drift", phase: "animate", query: [Item], run: () => {} } as const;

    expect(system(definition)).toBe(definition);
  });

  it("owns Layer, Order and Exiting", () => {
    expect(Layer({ name: "items" }).value).toEqual({ name: "items" });
    expect(Order({ value: 3 }).value).toEqual({ value: 3 });
    expect(Exiting()).toEqual({ type: Exiting, value: true });
  });

  it("refuses a second type object with a known name", () => {
    const world = createMockWorld();
    const other = component("Item", { kind: "", level: 1 });
    const owner = { kind: "plugin", name: "test" } as const;

    world.api.ecs.spawn(owner, [Item()]);

    expect(() => world.api.ecs.spawn(owner, [other()])).toThrow(
      '[game] Component "Item" is defined twice.\n  Use one component() call and import it.'
    );
  });
});
