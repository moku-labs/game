import { afterEach, describe, expect, it, vi } from "vitest";
import { component, mut, system, tag } from "../../ecs/define";
import type { Entity, Owner } from "../../ecs/types";
import { createMockWorld } from "./mock-world";

// ---------------------------------------------------------------------------
// Unit test: the query walk (spec 26 W1). The first case is the invariant the
// live walk relies on: structural changes made inside a phase are queued.
// ---------------------------------------------------------------------------

const Position = component("Position", { x: 0, y: 0 });
const Sprite = component("Sprite", { texture: "" });
const Speed = component("Speed", { value: 0 });
const Walked = component("Walked", { steps: 0 });
const Held = tag("Held");
const test: Owner = { kind: "plugin", name: "test" };
const other: Owner = { kind: "plugin", name: "other" };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the query walk", () => {
  it("a system's spawn, despawn, add, remove, tag and untag on the walked store change none of the rows of that walk", () => {
    const world = createMockWorld();
    const ecs = world.api.ecs;
    const [first, gone, owned, stripped, untagged, kept] = [
      test,
      test,
      other,
      test,
      test,
      test
    ].map(owner => ecs.spawn(owner, [Position(), Held()])) as [
      Entity,
      Entity,
      Entity,
      Entity,
      Entity,
      Entity
    ];
    const tagged = ecs.spawn(test, [Position()]);
    const bare = ecs.spawn(test, []);
    const seen: Entity[] = [];
    let spawned: Entity | undefined;

    ecs.system(
      system({
        name: "churn",
        phase: "animate",
        query: [Position, Held],
        run: (rows, { world: inner }) => {
          for (const [entity] of rows) {
            seen.push(entity);

            if (entity !== first) continue;

            spawned = inner.spawn(test, [Position(), Held()]);
            inner.despawn(gone);
            inner.despawnOwnedBy(other);
            inner.remove(stripped, Position);
            inner.untag(untagged, Held);
            inner.add(bare, Position({ x: 7 }));
            inner.tag(bare, Held);
            inner.tag(tagged, Held);
          }
        }
      })
    );
    world.start();
    world.frame();

    expect(seen).toEqual([first, gone, owned, stripped, untagged, kept]);
    expect([...ecs.query(Position, Held)].map(([entity]) => entity)).toEqual([
      first,
      kept,
      tagged,
      spawned,
      bare
    ]);
    expect(ecs.get(bare, Position)).toEqual({ x: 7, y: 0 });
  });

  it("yields only the entities that carry every term, in the first store's order, values in term order", () => {
    const world = createMockWorld();
    const ecs = world.api.ecs;
    const full = ecs.spawn(test, [Position({ x: 1 }), Sprite({ texture: "a" }), Speed()]);

    ecs.spawn(test, [Position({ x: 2 }), Sprite({ texture: "b" })]);
    ecs.spawn(test, [Position({ x: 3 }), Speed()]);

    const late = ecs.spawn(test, [Speed({ value: 4 }), Sprite({ texture: "c" }), Position()]);

    expect([...ecs.query(Position, Sprite, Speed)]).toEqual([
      [full, { x: 1, y: 0 }, { texture: "a" }, { value: 0 }],
      [late, { x: 0, y: 0 }, { texture: "c" }, { value: 4 }]
    ]);
  });

  it("builds rows of four and of five terms with every value in term order", () => {
    const world = createMockWorld();
    const ecs = world.api.ecs;
    const entity = ecs.spawn(test, [
      Position({ x: 1 }),
      Sprite({ texture: "a" }),
      Speed({ value: 2 }),
      Walked({ steps: 3 }),
      Held()
    ]);

    expect([...ecs.query(Position, Sprite, Speed, Walked)]).toEqual([
      [entity, { x: 1, y: 0 }, { texture: "a" }, { value: 2 }, { steps: 3 }]
    ]);
    expect([...ecs.query(Held, Walked, Speed, Sprite, Position)]).toEqual([
      [entity, true, { steps: 3 }, { value: 2 }, { texture: "a" }, { x: 1, y: 0 }]
    ]);
  });

  it("a mut term marks exactly the yielded rows", () => {
    const world = createMockWorld();
    const ecs = world.api.ecs;
    const yielded = ecs.spawn(test, [Position(), Sprite()]);

    ecs.spawn(test, [Sprite()]);
    ecs.spawn(test, [Position()]);
    world.start();
    world.frame();

    for (const row of ecs.query(Position, mut(Sprite))) expect(row[0]).toBe(yielded);

    expect([...ecs.changed(Sprite)]).toEqual([yielded]);
    expect([...ecs.changed(Position)]).toEqual([]);
  });

  it("every yielded row is its own array: rows kept with a spread stay distinct", () => {
    const world = createMockWorld();
    const ecs = world.api.ecs;
    const one = ecs.spawn(test, [Position({ x: 1 })]);
    const two = ecs.spawn(test, [Position({ x: 2 })]);

    const rows = [...ecs.query(Position)];

    expect(rows).toEqual([
      [one, { x: 1, y: 0 }],
      [two, { x: 2, y: 0 }]
    ]);
    expect(rows[0]).not.toBe(rows[1]);
    expect(rows[0]?.[1]).toBe(ecs.get(one, Position));
  });

  it("outside a phase a one-term walk skips an entity the loop body despawned before its turn", () => {
    const world = createMockWorld();
    const ecs = world.api.ecs;
    const first = ecs.spawn(test, [Position()]);
    const second = ecs.spawn(test, [Position()]);
    const third = ecs.spawn(test, [Position()]);
    const seen: Entity[] = [];

    for (const [entity] of ecs.query(Position)) {
      seen.push(entity);

      if (entity === first) ecs.despawn(second);
    }

    expect(seen).toEqual([first, third]);
  });

  it("outside a phase a walk does not visit an entity spawned during it", () => {
    const world = createMockWorld();
    const ecs = world.api.ecs;
    const first = ecs.spawn(test, [Position()]);
    const seen: Entity[] = [];

    for (const [entity] of ecs.query(Position)) {
      seen.push(entity);
      ecs.spawn(test, [Position()]);
    }

    expect(seen).toEqual([first]);
    expect([...ecs.query(Position)]).toHaveLength(2);
  });

  it("a system's query is resolved once: registering it registers its types, a frame does not", () => {
    const world = createMockWorld();
    const ecs = world.api.ecs;
    const types = world.ctx.state.ecs.types;

    ecs.spawn(test, [Walked(), Held()]);
    ecs.system(
      system({
        name: "walker",
        phase: "animate",
        query: [mut(Walked), Held],
        run: rows => {
          for (const [, walked] of rows) walked.steps += 1;
        }
      })
    );
    world.start();

    const get = vi.spyOn(types, "get");
    const set = vi.spyOn(types, "set");

    for (let frame = 0; frame < 100; frame += 1) world.frame();

    const asked = [...get.mock.calls, ...set.mock.calls].filter(
      ([name]) => name === "Walked" || name === "Held"
    );

    expect(asked).toEqual([]);
    expect([...ecs.query(Walked)][0]?.[1]).toEqual({ steps: 100 });
  });

  it("a dev build reports a store whose size changes during a walk inside a phase, once", () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);

    const world = createMockWorld();
    const ecs = world.api.ecs;
    const stores = world.ctx.state.ecs.stores;
    let wroteIn = -1;

    ecs.spawn(test, [Position()]);
    ecs.spawn(test, [Position()]);
    ecs.system(
      system({
        name: "writesBehindTheBack",
        phase: "layout",
        query: [Position],
        run: (rows, { time }) => {
          for (const row of rows) {
            if (wroteIn === time.frame) continue;

            // A test-only write into the store, past the command queue: one new key a frame.
            wroteIn = time.frame;
            stores.get("Position")?.set(row[0] + 9_000_000 + time.frame, { x: 0, y: 0 });
          }
        }
      })
    );
    world.start();
    world.frame();
    world.frame();

    const reports = vi
      .mocked(world.log.error)
      .mock.calls.filter(([event]) => event === "world:store-changed-during-walk");

    expect(reports).toEqual([["world:store-changed-during-walk", { component: "Position" }]]);
  });
});
