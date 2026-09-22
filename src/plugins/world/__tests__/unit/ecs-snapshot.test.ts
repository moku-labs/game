import { describe, expect, it } from "vitest";
import { component, resource, Tree, tag } from "../../ecs/define";
import type { Owner } from "../../ecs/types";
import { createMockWorld } from "./mock-world";

const Position = component("Position", { x: 0, y: 0 });
const Display = component("Display", { object: {} as unknown });
const Held = tag("Held");
const Pointer = resource("Pointer", { x: 0, down: false });
const test: Owner = { kind: "plugin", name: "test" };

describe("ecs snapshot", () => {
  it("returns plain JSON sorted by index, with the mode and the resources", () => {
    const world = createMockWorld();

    world.api.ecs.resource(Pointer).down = true;

    const first = world.api.ecs.spawn(test, [Position({ x: 1 })]);

    world.api.ecs.spawn(test, [Position({ x: 2 })]);
    world.api.ecs.tag(first, Held);

    expect(world.api.ecs.snapshot()).toEqual({
      mode: "live",
      entities: [
        {
          id: first,
          index: 0,
          generation: 1,
          owner: test,
          components: { Position: { x: 1, y: 0 }, Held: true },
          skipped: []
        },
        {
          id: 2 ** 20 + 1,
          index: 1,
          generation: 1,
          owner: test,
          components: { Position: { x: 2, y: 0 } },
          skipped: []
        }
      ],
      resources: { Pointer: { x: 0, down: true } }
    });
  });

  it("skips the Tree of a screen and names it, JSON or not", () => {
    const world = createMockWorld();
    const entity = world.api.ecs.spawn(test, [
      Tree({ node: { type: "box", props: {}, children: [] } }),
      Position({ x: 3 })
    ]);
    const snapshot = world.api.ecs.snapshot() as {
      entities: Array<{ components: Record<string, unknown>; skipped: string[] }>;
    };

    expect(entity).toBe(2 ** 20);
    expect(snapshot.entities[0]?.components).toEqual({ Position: { x: 3, y: 0 } });
    expect(snapshot.entities[0]?.skipped).toEqual(["Tree"]);
  });

  it("skips a component value that is not JSON and names it", () => {
    const world = createMockWorld();
    const entity = world.api.ecs.spawn(test, [Display({ object: () => undefined })]);
    const snapshot = world.api.ecs.snapshot() as {
      entities: Array<{ components: Record<string, unknown>; skipped: string[] }>;
    };

    expect(entity).toBe(2 ** 20);
    expect(snapshot.entities[0]?.components).toEqual({});
    expect(snapshot.entities[0]?.skipped).toEqual(["Display"]);
  });
});
