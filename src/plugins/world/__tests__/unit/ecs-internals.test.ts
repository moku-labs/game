import { describe, expect, it, vi } from "vitest";
import { createModules } from "../../api";
import { component, resource, system, tag } from "../../ecs/define";
import { releaseEntity, reserveEntity } from "../../ecs/entities";
import { isJson } from "../../ecs/snapshot";
import { createEcsState } from "../../ecs/state";
import { asError } from "../../ecs/storage";
import type { Entity, Owner } from "../../ecs/types";
import { withDeps } from "../../lifecycle";
import { createMockWorld } from "./mock-world";

// ---------------------------------------------------------------------------
// Unit test: the defensive paths of ecs — internals, stale ids and the JSON check
// ---------------------------------------------------------------------------

const Position = component("Position", { x: 0, y: 0 });
const Display = component("Display", { object: {} as unknown });
const Held = tag("Held");
const Pointer = resource("Pointer", { x: 0, down: false });
const test: Owner = { kind: "plugin", name: "test" };
const ghost: Owner = { kind: "node", name: "ghost" };

describe("ecs internals", () => {
  it("flushes, clears the change sets and empties the world", () => {
    const world = createMockWorld();
    const { ecs } = createModules(withDeps(world.ctx));
    const entity = ecs.spawn(test, [Position({ x: 3 })]);

    ecs.resource(Pointer).down = true;
    expect([...ecs.changed(Position)]).toEqual([entity]);

    ecs.clearChanges();
    expect([...ecs.changed(Position)]).toEqual([]);

    ecs.flush();
    expect(ecs.has(entity, Position)).toBe(true);

    ecs.clear();

    expect(ecs.has(entity, Position)).toBe(false);
    expect(ecs.snapshot()).toEqual({ mode: "live", entities: [], resources: {} });
  });

  it("removes an owner listener once, and a second removal is a no-op", () => {
    const world = createMockWorld();
    const { ecs } = createModules(withDeps(world.ctx));
    const seen: Owner[] = [];
    const off = ecs.onOwnerLeft(owner => seen.push(owner));

    ecs.spawn(test, [Position()]);
    ecs.despawnOwnedBy(test);
    expect(seen).toEqual([test]);

    off();
    off();
    ecs.spawn(test, [Position()]);
    ecs.despawnOwnedBy(test);

    expect(seen).toEqual([test]);
  });

  it("despawns an owner that never owned anything without touching the world", () => {
    const world = createMockWorld();
    const mine = world.api.ecs.spawn(test, [Position()]);

    world.api.ecs.despawnOwnedBy(ghost);

    expect(world.api.ecs.has(mine, Position)).toBe(true);
  });

  it("drops a despawn of an id that is already gone", () => {
    const world = createMockWorld();
    const entity = world.api.ecs.spawn(test, [Position()]);

    world.api.ecs.despawn(entity);
    world.api.ecs.despawn(entity);

    expect(world.api.ecs.snapshot()).toMatchObject({ entities: [] });
  });

  it("yields nothing for a query with no terms", () => {
    const world = createMockWorld();

    world.api.ecs.spawn(test, [Position()]);

    expect([...world.api.ecs.query()]).toEqual([]);
  });

  it("hands a system the same resource object on every read", () => {
    const world = createMockWorld();
    const seen: Array<{ x: number }> = [];

    world.api.ecs.spawn(test, [Position()]);
    world.api.ecs.system(
      system({
        name: "pointer",
        phase: "input",
        query: [Position],
        run: (entities, ctx) => {
          for (const [entity] of entities) {
            if (!Number.isSafeInteger(entity)) return;
            ctx.res(Pointer).x += 1;
            seen.push(ctx.res(Pointer));
          }
        }
      })
    );
    world.start();
    world.frame();
    world.frame();

    expect(seen[0]).toBe(seen[1]);
    expect(world.api.ecs.resource(Pointer).x).toBe(2);
  });

  it("keeps the resource it already created instead of cloning the defaults again", () => {
    const world = createMockWorld();

    world.api.ecs.resource(Pointer).x = 9;

    expect(world.api.ecs.resource(Pointer).x).toBe(9);
    expect(world.api.ecs.resource(Pointer)).toBe(world.api.ecs.resource(Pointer));
  });

  it("reports a thrown value that is not an Error as one", () => {
    const world = createMockWorld();

    world.api.ecs.onAdded(Position, () => {
      // A hook may throw anything; the log still gets an Error.
      throw "boom";
    });
    world.api.ecs.spawn(test, [Position()]);

    expect(world.log.error).toHaveBeenCalledWith(
      "world:added-hook-failed",
      expect.anything(),
      expect.any(Error)
    );
    expect(asError("boom").message).toBe("boom");
  });
});

describe("ecs entity ids", () => {
  it("starts a freed index that has no generation on record at generation 1", () => {
    const state = createEcsState();

    state.free.push(3);

    const entity: Entity = reserveEntity(state, test);

    expect(entity).toBe(2 ** 20 + 3);
    expect(state.owners.get(entity)).toEqual(test);
  });

  it("bumps the generation of such an index when it is released", () => {
    const state = createEcsState();

    state.free.push(3);

    const entity = reserveEntity(state, test);

    releaseEntity(state, entity);

    expect(state.generations[3]).toBe(2);
    expect(state.free).toEqual([3]);
  });

  it("does nothing when an id without an owner is released", () => {
    const state = createEcsState();

    expect(() => releaseEntity(state, 42)).not.toThrow();
    expect(state.free).toEqual([]);
  });

  it("drops the owner index of an owner whose last entity left", () => {
    const state = createEcsState();
    const entity = reserveEntity(state, test);

    expect(state.byOwner.size).toBe(1);

    releaseEntity(state, entity);

    expect(state.byOwner.size).toBe(0);
  });
});

/* eslint-disable unicorn/no-null -- `null` is a JSON value the world has to classify */
describe("isJson", () => {
  it("accepts null, primitives, arrays and plain objects", () => {
    expect(isJson(null)).toBe(true);
    expect(isJson(true)).toBe(true);
    expect(isJson(7)).toBe(true);
    expect(isJson("a")).toBe(true);
    expect(isJson([1, "a", null])).toBe(true);
    expect(isJson({ a: { b: [1] } })).toBe(true);
  });

  it("refuses a function, a class instance and an array that holds one", () => {
    expect(isJson(() => 1)).toBe(false);
    expect(isJson(new Map())).toBe(false);
    expect(isJson([1, () => 1])).toBe(false);
    expect(isJson({ a: new Map() })).toBe(false);
  });

  it("leaves a resource that is not JSON out of the snapshot", () => {
    const world = createMockWorld();
    const Handles = resource("Handles", { list: [] as unknown[] });

    world.api.ecs.resource(Handles).list.push(() => 1);
    world.api.ecs.resource(Pointer).x = 2;

    const snapshot = world.api.ecs.snapshot() as { resources: Record<string, unknown> };

    expect(Object.keys(snapshot.resources)).toEqual(["Pointer"]);
  });

  it("keeps a tag in the snapshot as true", () => {
    const world = createMockWorld();
    const entity = world.api.ecs.spawn(test, [Display({ object: vi.fn() })]);

    world.api.ecs.tag(entity, Held);

    const snapshot = world.api.ecs.snapshot() as {
      entities: Array<{ components: Record<string, unknown>; skipped: string[] }>;
    };

    expect(snapshot.entities[0]?.components).toEqual({ Held: true });
    expect(snapshot.entities[0]?.skipped).toEqual(["Display"]);
  });
});
/* eslint-enable unicorn/no-null */
