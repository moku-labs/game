import { describe, expect, it } from "vitest";
import { createModules } from "../../api";
import { component, resource, tag } from "../../ecs/define";
import type { Owner } from "../../ecs/types";
import { withDeps } from "../../lifecycle";
import { createMockWorld } from "./mock-world";

// ---------------------------------------------------------------------------
// Unit test: the calls a game makes every frame find the store of a component
// type, and the value of a resource type, once per world (change
// 2026-10-18-cheap-idle-tick, W6). What is found stays true across a clear, and
// a second type object of a known name is still refused.
// ---------------------------------------------------------------------------

const Position = component("Position", { x: 0, y: 0 });
const Held = tag("Held");
const Score = resource("Score", { points: 0 });
const test: Owner = { kind: "plugin", name: "test" };

describe("the ecs calls of every frame", () => {
  it("read, write and ask the world that is there after ecs.clear(), not the one before", () => {
    const world = createMockWorld();
    const { ecs } = createModules(withDeps(world.ctx));
    const before = ecs.spawn(test, [Position({ x: 1 }), Held()]);

    ecs.set(before, Position, { x: 2 });
    expect(ecs.get(before, Position)).toEqual({ x: 2, y: 0 });
    expect(ecs.has(before, Held)).toBe(true);
    ecs.resource(Score).points = 7;

    ecs.clear();

    const after = ecs.spawn(test, [Position({ x: 5 }), Held()]);

    expect(ecs.get(after, Position)).toEqual({ x: 5, y: 0 });
    expect(ecs.has(after, Held)).toBe(true);
    ecs.set(after, Position, { y: 3 });
    expect(ecs.get(after, Position)).toEqual({ x: 5, y: 3 });
    expect([...ecs.changed(Position)]).toEqual([after]);
    expect([...ecs.query(Position, Held)].map(([entity]) => entity)).toEqual([after]);
    expect(ecs.resource(Score)).toEqual({ points: 0 });
  });

  it("still refuse a second type object of a name the world already reads through", () => {
    const world = createMockWorld();
    const ecs = world.api.ecs;
    const entity = ecs.spawn(test, [Position(), Held()]);
    const Twin = component("Position", { x: 0, y: 0 });
    const TwinTag = tag("Held");

    ecs.get(entity, Position);
    ecs.has(entity, Held);

    expect(() => ecs.get(entity, Twin)).toThrow('Component "Position" is defined twice');
    expect(() => ecs.set(entity, Twin, { x: 1 })).toThrow('Component "Position" is defined twice');
    expect(() => ecs.has(entity, TwinTag)).toThrow('Component "Held" is defined twice');
  });

  it("name a stale entity and a missing component on set, as before", () => {
    const world = createMockWorld();
    const ecs = world.api.ecs;
    const kept = ecs.spawn(test, [Position()]);
    const bare = ecs.spawn(test, [Held()]);
    const gone = ecs.spawn(test, [Position()]);

    ecs.set(kept, Position, { x: 1 });
    ecs.despawn(gone);

    expect(() => ecs.set(gone, Position, { x: 1 })).toThrow(`Entity ${gone} is gone`);
    expect(() => ecs.set(bare, Position, { x: 1 })).toThrow(`Entity ${bare} carries no "Position"`);
  });

  it("answer a component no entity carried yet, and find its store once one does", () => {
    const world = createMockWorld();
    const ecs = world.api.ecs;
    const bare = ecs.spawn(test, []);

    expect(ecs.get(bare, Position)).toBeUndefined();
    expect(ecs.has(bare, Position)).toBe(false);

    ecs.add(bare, Position({ x: 4 }));

    expect(ecs.get(bare, Position)).toEqual({ x: 4, y: 0 });
    expect(ecs.has(bare, Position)).toBe(true);
  });
});
