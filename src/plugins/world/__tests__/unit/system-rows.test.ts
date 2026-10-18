import { describe, expect, it } from "vitest";
import { component, resource, system } from "../../ecs/define";
import type { Entity, Owner } from "../../ecs/types";
import { createMockWorld } from "./mock-world";

// ---------------------------------------------------------------------------
// Unit test: the walk the runner makes for a system's declared query (change
// 2026-10-18-cheap-idle-tick, W1 and W5). One walk per system, reset every run;
// its rows share one array, valid until the next row. `ecs.query()` keeps fresh
// rows everywhere, also inside a system.
// ---------------------------------------------------------------------------

const Position = component("Position", { x: 0, y: 0 });
const Late = component("Late", { at: 0 });
const Pointer = resource("Pointer", { x: 0 });
const test: Owner = { kind: "plugin", name: "test" };

describe("the rows of a system", () => {
  it("are one array, rewritten for every row: a kept row holds the last one, a copy keeps its own", () => {
    const world = createMockWorld();
    const ecs = world.api.ecs;
    const entities = [1, 2, 3].map(x => ecs.spawn(test, [Position({ x })]));
    const kept: unknown[] = [];
    const copies: unknown[] = [];

    ecs.system(
      system({
        name: "keeper",
        phase: "animate",
        query: [Position],
        run: rows => {
          for (const row of rows) {
            kept.push(row);
            copies.push([...row]);
          }
        }
      })
    );
    world.start();
    world.frame();

    expect(copies).toEqual([
      [entities[0], { x: 1, y: 0 }],
      [entities[1], { x: 2, y: 0 }],
      [entities[2], { x: 3, y: 0 }]
    ]);
    expect(kept[0]).toBe(kept[1]);
    expect(kept[1]).toBe(kept[2]);
    expect(kept[0]).toEqual([entities[2], { x: 3, y: 0 }]);
  });

  it("leave ecs.query() inside a system with fresh rows", () => {
    const world = createMockWorld();
    const ecs = world.api.ecs;
    const one = ecs.spawn(test, [Position({ x: 1 })]);
    const two = ecs.spawn(test, [Position({ x: 2 })]);
    let inner: unknown[] = [];

    ecs.system(
      system({
        name: "asker",
        phase: "animate",
        query: [Position],
        run: (_rows, { world: inside }) => {
          inner = [...inside.query(Position)];
        }
      })
    );
    world.start();
    world.frame();

    expect(inner).toEqual([
      [one, { x: 1, y: 0 }],
      [two, { x: 2, y: 0 }]
    ]);
    expect(inner[0]).not.toBe(inner[1]);
  });

  it("are walked again from the start every frame, after the entities changed between frames", () => {
    const world = createMockWorld();
    const ecs = world.api.ecs;
    const first = ecs.spawn(test, [Position({ x: 1 })]);
    const second = ecs.spawn(test, [Position({ x: 2 })]);
    const frames: Entity[][] = [];

    ecs.system(
      system({
        name: "lister",
        phase: "layout",
        query: [Position],
        run: rows => {
          const seen: Entity[] = [];

          for (const [entity] of rows) seen.push(entity);
          frames.push(seen);
        }
      })
    );
    world.start();
    world.frame();
    ecs.despawn(first);

    const third = ecs.spawn(test, [Position({ x: 3 })]);

    world.frame();

    expect(frames).toEqual([
      [first, second],
      [second, third]
    ]);
  });

  it("are yielded once per run, also to a system that walks them twice", () => {
    const world = createMockWorld();
    const ecs = world.api.ecs;
    const counts: number[] = [];

    ecs.spawn(test, [Position()]);
    ecs.spawn(test, [Position()]);
    ecs.system(
      system({
        name: "twice",
        phase: "animate",
        query: [Position],
        run: rows => {
          counts.push([...rows].length, [...rows].length);
        }
      })
    );
    world.start();
    world.frame();
    world.frame();

    expect(counts).toEqual([2, 0, 2, 0]);
  });

  it("include a component whose store did not exist when the system registered", () => {
    const world = createMockWorld();
    const ecs = world.api.ecs;
    const frames: Entity[][] = [];

    ecs.system(
      system({
        name: "late",
        phase: "animate",
        query: [Position, Late],
        run: rows => {
          const seen: Entity[] = [];

          for (const [entity] of rows) seen.push(entity);
          frames.push(seen);
        }
      })
    );
    world.start();
    world.frame();

    const entity = ecs.spawn(test, [Position(), Late({ at: 2 })]);

    world.frame();

    // The first frame has no `Late` at all, so the system is skipped there (it ran with no row
    // before the skip of an empty query); the frame after sees the store made since.
    expect(frames).toEqual([[entity]]);
  });

  it("are none for a system with an empty query, which still runs every frame", () => {
    const world = createMockWorld();
    const ecs = world.api.ecs;
    const counts: number[] = [];

    ecs.spawn(test, [Position()]);
    ecs.system(
      system({
        name: "empty",
        phase: "input",
        query: [],
        run: rows => {
          counts.push([...rows].length);
        }
      })
    );
    world.start();
    world.frame();
    world.frame();

    expect(counts).toEqual([0, 0]);
  });
});

describe("the context of a system", () => {
  it("carries the time and the snapshot of each frame, and the same resources", () => {
    const world = createMockWorld();
    const seen: Array<{ delta: number; coins: unknown; pointer: unknown }> = [];

    world.model.player = { coins: 4 };
    world.api.ecs.system(
      system({
        name: "reader",
        phase: "sync",
        query: [],
        run: (_rows, ctx) => {
          seen.push({
            delta: ctx.time.delta,
            coins: (ctx.snapshot.player as { coins: number }).coins,
            pointer: ctx.res(Pointer)
          });
        }
      })
    );
    world.start();
    world.frame(20);
    world.model.player = { coins: 9 };
    world.frame(30);

    expect(seen).toEqual([
      { delta: 20, coins: 4, pointer: { x: 0 } },
      { delta: 30, coins: 9, pointer: { x: 0 } }
    ]);
    expect(seen[0]?.pointer).toBe(seen[1]?.pointer);
  });
});
