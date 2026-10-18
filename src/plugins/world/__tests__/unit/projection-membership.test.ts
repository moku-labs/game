import { describe, expect, it } from "vitest";
import { createModules } from "../../api";
import { withDeps } from "../../lifecycle";
import { membershipVersion } from "../../membership";
import { type Item, mountBoard, Transform } from "./board";
import { createMockWorld, type MockWorld } from "./mock-world";

// ---------------------------------------------------------------------------
// Unit test: what `ui` reads to host the views of a projection only when they
// changed (change 2026-10-18-cheap-idle-tick, U1): `keyOf` answers the address a
// view keeps, and `membershipVersion` moves when a view comes or goes.
// ---------------------------------------------------------------------------

const items: Item[] = [
  { id: "a", level: 1, x: 0, y: 0 },
  { id: "b", level: 1, x: 10, y: 0 }
];

/**
 * Commits a new item list and steps one frame.
 *
 * @param world - The mock world.
 * @param next - The items.
 */
function commitAndStep(world: MockWorld, next: Item[]): void {
  world.model.player = { items: next } as unknown as MockWorld["model"]["player"];
  world.commit();
  world.frame(16);
}

describe("keyOf of a view", () => {
  it("answers the address the view keeps: one object, every call", () => {
    const world = createMockWorld();

    mountBoard(world, items);

    const entity = world.api.projection.entityOf("board.items", "a") ?? 0;
    const first = world.api.projection.keyOf(entity);

    expect(first).toEqual({ projection: "board.items", key: "a" });
    expect(world.api.projection.keyOf(entity)).toBe(first);
  });
});

describe("membershipVersion", () => {
  it("stays put over frames where no view comes or goes", () => {
    const world = createMockWorld();

    mountBoard(world, items);
    world.frame(16);

    const before = membershipVersion(world.api);

    world.frame(16);
    world.frame(16);
    commitAndStep(world, [
      { id: "a", level: 2, x: 0, y: 0 },
      { id: "b", level: 1, x: 10, y: 0 }
    ]);

    expect(membershipVersion(world.api)).toBe(before);
  });

  it("moves when a view enters, when one leaves, and when the sweep forgets the left view", () => {
    const world = createMockWorld();
    const { projection } = createModules(withDeps(world.ctx));

    expect(membershipVersion(world.api)).toBe(0);

    mountBoard(world, items);

    const mounted = membershipVersion(world.api);

    expect(mounted).toBeGreaterThan(0);

    commitAndStep(world, [...items, { id: "c", level: 1, x: 20, y: 0 }]);

    const entered = membershipVersion(world.api);

    expect(entered).toBeGreaterThan(mounted);

    world.model.player = { items } as unknown as MockWorld["model"]["player"];
    world.commit();
    projection.reconcileIfDirty();

    const left = membershipVersion(world.api);

    expect(left).toBeGreaterThan(entered);

    projection.sweep();

    expect(membershipVersion(world.api)).toBeGreaterThan(left);
  });

  it("moves when a view starts its exit, before it is despawned", () => {
    const world = createMockWorld();

    mountBoard(world, items, {
      exit: view => view.tween(Transform, { x: 900 }, { ms: 1000, ease: "linear" })
    });
    world.frame(16);

    const before = membershipVersion(world.api);

    world.model.player = { items: [items[0]] } as unknown as MockWorld["model"]["player"];
    world.commit();
    world.frame(16);

    expect(world.api.projection.entitiesOf("board.items")).toHaveLength(1);
    expect(membershipVersion(world.api)).toBeGreaterThan(before);
  });

  it("moves when a projection is unmounted", () => {
    const world = createMockWorld();

    mountBoard(world, items);

    const before = membershipVersion(world.api);

    world.api.projection.unmount(["board.items"]);

    expect(membershipVersion(world.api)).toBeGreaterThan(before);
  });
});
