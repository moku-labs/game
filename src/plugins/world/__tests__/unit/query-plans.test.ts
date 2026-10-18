import { describe, expect, it } from "vitest";
import { createModules } from "../../api";
import { component, mut, tag } from "../../ecs/define";
import type { Entity, Owner } from "../../ecs/types";
import { withDeps } from "../../lifecycle";
import { createMockWorld } from "./mock-world";

// ---------------------------------------------------------------------------
// Unit test: `ecs.query()` remembers its plan per tuple of types and lists the
// keys it visits into a list the world keeps (change 2026-10-18-cheap-idle-tick,
// Q1). What a call yields stays what it yielded before.
// ---------------------------------------------------------------------------

const Position = component("Position", { x: 0, y: 0 });
const Sprite = component("Sprite", { texture: "" });
const Held = tag("Held");
const test: Owner = { kind: "plugin", name: "test" };

/**
 * The entities of a walk.
 *
 * @param rows - The rows.
 * @returns The first entry of every row.
 */
function entitiesOf(rows: Iterable<readonly unknown[]>): unknown[] {
  return [...rows].map(row => row[0]);
}

describe("ecs.query plans", () => {
  it("tell tuples apart that start with the same type, and a mut() term from a plain one", () => {
    const world = createMockWorld();
    const ecs = world.api.ecs;
    const both = ecs.spawn(test, [Position(), Sprite(), Held()]);
    const held = ecs.spawn(test, [Position(), Held()]);

    expect(entitiesOf(ecs.query(Position, Sprite))).toEqual([both]);
    expect(entitiesOf(ecs.query(Position, Held))).toEqual([both, held]);
    expect(entitiesOf(ecs.query(Position))).toEqual([both, held]);
    expect(entitiesOf(ecs.query(Position, Sprite))).toEqual([both]);

    createModules(withDeps(world.ctx)).ecs.clearChanges();
    entitiesOf(ecs.query(Position, Sprite));
    expect([...ecs.changed(Position)]).toEqual([]);

    // A new mut() object every call: the plan is found by type, and it marks.
    entitiesOf(ecs.query(mut(Position), Sprite));
    entitiesOf(ecs.query(mut(Position), Sprite));
    expect([...ecs.changed(Position)]).toEqual([both]);
  });

  it("are made again after ecs.clear(), and a second type object of a known name still throws", () => {
    const world = createMockWorld();
    const { ecs } = createModules(withDeps(world.ctx));

    ecs.spawn(test, [Position()]);
    entitiesOf(ecs.query(Position));
    ecs.clear();

    expect(ecs.typeOf("Position")).toBeUndefined();

    const fresh = ecs.spawn(test, [Sprite()]);

    expect(entitiesOf(ecs.query(Position))).toEqual([]);
    expect(ecs.typeOf("Position")).toBe(Position);
    expect(entitiesOf(ecs.query(Sprite))).toEqual([fresh]);

    const Twin = component("Position", { x: 0, y: 0 });

    expect(() => ecs.query(Twin)).toThrow('Component "Position" is defined twice');
  });
});

describe("ecs.query walks", () => {
  it("visit an entity that gains a term before its turn, outside a phase, as the key copy did", () => {
    const world = createMockWorld();
    const ecs = world.api.ecs;
    const first = ecs.spawn(test, [Position()]);
    const second = ecs.spawn(test, [Position()]);
    const seen: Entity[] = [];

    for (const [entity] of ecs.query(Position, Held)) seen.push(entity);
    expect(seen).toEqual([]);

    ecs.tag(first, Held);

    for (const [entity] of ecs.query(Position, Held)) {
      seen.push(entity);
      ecs.tag(second, Held);
    }

    expect(seen).toEqual([first, second]);
  });

  it("nest, stop early and end without one walk changing another's rows", () => {
    const world = createMockWorld();
    const ecs = world.api.ecs;
    const entities = [1, 2, 3].map(x => ecs.spawn(test, [Position({ x }), Held()]));
    const pairs: string[] = [];

    for (const [outer] of ecs.query(Position, Held)) {
      for (const [inner] of ecs.query(Position)) {
        pairs.push(`${outer}:${inner}`);
        if (inner === entities[1]) break;
      }
    }

    expect(pairs).toHaveLength(6);
    expect(entitiesOf(ecs.query(Held))).toEqual(entities);

    const walk = ecs.query(Position);

    expect(entitiesOf(walk)).toEqual(entities);
    expect(entitiesOf(walk)).toEqual([]);
    expect(entitiesOf(ecs.query(Position))).toEqual(entities);
  });
});
