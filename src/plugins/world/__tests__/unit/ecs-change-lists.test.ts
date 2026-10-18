import { describe, expect, it } from "vitest";
import { createModules } from "../../api";
import { component, system, tag } from "../../ecs/define";
import type { Owner } from "../../ecs/types";
import { withDeps } from "../../lifecycle";
import { createMockWorld } from "./mock-world";

// ---------------------------------------------------------------------------
// Unit test: the change lists are kept from frame to frame and emptied in place
// (change 2026-10-18-cheap-idle-tick, W2). What a frame reports stays what it
// reported before: each marked entity once, in mark order, none after the clear.
// ---------------------------------------------------------------------------

const Position = component("Position", { x: 0, y: 0 });
const Sprite = component("Sprite", { texture: "" });
const Held = tag("Held");
const test: Owner = { kind: "plugin", name: "test" };

describe("the change lists", () => {
  it("report an entity marked again in the next frame, once in each", () => {
    const { ecs } = createModules(withDeps(createMockWorld().ctx));
    const entity = ecs.spawn(test, [Position()]);

    ecs.clearChanges();
    ecs.set(entity, Position, { x: 1 });
    ecs.set(entity, Position, { x: 2 });
    expect([...ecs.changed(Position)]).toEqual([entity]);

    ecs.clearChanges();
    expect([...ecs.changed(Position)]).toEqual([]);

    ecs.set(entity, Position, { x: 3 });
    ecs.set(entity, Position, { x: 4 });
    expect([...ecs.changed(Position)]).toEqual([entity]);
  });

  it("keep the mark order of the others when one entity leaves, and take it back when it is marked again", () => {
    const { ecs } = createModules(withDeps(createMockWorld().ctx));
    const [first, second, third] = [1, 2, 3].map(x =>
      ecs.spawn(test, [Position({ x }), Sprite(), Held()])
    );

    ecs.clearChanges();

    for (const entity of [first, second, third]) {
      if (entity !== undefined) ecs.set(entity, Sprite, { texture: "a" });
    }

    if (second !== undefined) ecs.remove(second, Sprite);
    expect([...ecs.changed(Sprite)]).toEqual([first, third]);

    if (second !== undefined) ecs.add(second, Sprite({ texture: "b" }));
    expect([...ecs.changed(Sprite)]).toEqual([first, third, second]);

    if (first !== undefined) ecs.despawn(first);
    expect([...ecs.changed(Sprite)]).toEqual([third, second]);
  });

  it("lose no entity to a despawn or a removal inside a system, and a copy loses none outside a phase", () => {
    const world = createMockWorld();
    const ecs = world.api.ecs;
    const [first, second, third, fourth] = [1, 2, 3, 4].map(x =>
      ecs.spawn(test, [Position({ x })])
    );
    const inPhase: number[] = [];
    const outside: number[] = [];

    ecs.system(
      system({
        name: "taker",
        phase: "sync",
        query: [],
        run: (_rows, { world: inner }) => {
          for (const entity of inner.changed(Position)) {
            inPhase.push(entity);

            if (entity === first) inner.despawn(entity);
            if (entity === second && third !== undefined) inner.despawn(third);
            if (entity === fourth) inner.remove(entity, Position);
          }
        }
      })
    );
    world.start();
    // The spawns marked all four; the phase sees them all, its despawns wait for its end.
    world.frame();

    expect(inPhase).toEqual([first, second, third, fourth]);

    const [fifth, sixth] = [5, 6].map(x => ecs.spawn(test, [Position({ x })]));

    const copy = [...ecs.changed(Position)];

    for (const entity of copy) {
      outside.push(entity);
      ecs.despawn(entity);
    }

    expect(outside).toEqual([fifth, sixth]);
    expect([...ecs.changed(Position)]).toEqual([]);
  });

  it("are walked again inside a walk of the same list, each walk on its own", () => {
    const { ecs } = createModules(withDeps(createMockWorld().ctx));
    const [first, second] = [1, 2].map(x => ecs.spawn(test, [Position({ x })]));
    const pairs: string[] = [];

    for (const outer of ecs.changed(Position)) {
      for (const inner of ecs.changed(Position)) pairs.push(`${outer}:${inner}`);
    }

    expect(pairs).toEqual([
      `${first}:${first}`,
      `${first}:${second}`,
      `${second}:${first}`,
      `${second}:${second}`
    ]);
  });

  it("forget a despawned entity, so its index coming back marks the new entity alone", () => {
    const { ecs } = createModules(withDeps(createMockWorld().ctx));
    const gone = ecs.spawn(test, [Position()]);

    ecs.despawn(gone);
    ecs.clearChanges();

    const next = ecs.spawn(test, [Position()]);

    expect(next).not.toBe(gone);
    expect([...ecs.changed(Position)]).toEqual([next]);
  });
});
