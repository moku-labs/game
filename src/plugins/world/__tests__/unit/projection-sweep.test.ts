import { describe, expect, it } from "vitest";
import type { Owner } from "../../ecs/types";
import { BOARD, type Item, mountBoard, Transform, viewOf } from "./board";
import { createMockWorld } from "./mock-world";

// ---------------------------------------------------------------------------
// Unit test: the sweep does its work only when there is some (change
// 2026-10-18-cheap-idle-tick, W4): the live views are walked while one may hold
// a motion, the dead elements are looked for after a despawn or a new key, and
// the owed loops while one is owed. What it does when it works is unchanged.
// ---------------------------------------------------------------------------

const UI: Owner = { kind: "plugin", name: "ui" };
const items: Item[] = [
  { id: "a", level: 1, x: 0, y: 0 },
  { id: "b", level: 1, x: 10, y: 0 }
];

describe("the sweep", () => {
  it("drops a key registered for an entity that was already gone, in the next frame", () => {
    const world = createMockWorld();

    mountBoard(world, items);
    world.frame(16);

    const element = world.api.ecs.spawn(UI, [Transform()]);

    world.api.ecs.despawn(element);
    world.frame(16);
    world.api.projection.registerKey("hud", "coins", element);
    world.frame(16);

    expect(world.api.projection.entityOf("hud", "coins")).toBeUndefined();
    expect(world.api.projection.keyOf(element)).toBeUndefined();
  });

  it("settles a view whose motion ends after frames in which nothing else moved", () => {
    const world = createMockWorld();

    mountBoard(world, items);
    world.frame(16);
    world.frame(16);

    const entity = world.api.projection.entityOf(BOARD, "a") ?? 0;
    const view = viewOf(world, "a");

    if (view === undefined) throw new Error("no view a");

    world.api.ecs.set(entity, Transform, { x: 300 });
    world.api.projection.settle(entity);

    expect(view.handles.length).toBeGreaterThan(0);

    for (let frame = 0; frame < 40; frame += 1) world.frame(16);

    expect(view.handles).toEqual([]);
    expect(world.api.ecs.get(entity, Transform)).toEqual({ x: 0, y: 0, scale: 1 });
    expect(world.ctx.state.projection.tracks).toEqual([]);
  });
});
