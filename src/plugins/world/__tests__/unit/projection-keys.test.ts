import { describe, expect, it } from "vitest";
import { Exiting } from "../../ecs/define";
import type { Owner } from "../../ecs/types";
import type { MotionHandle, ProjectionMotion } from "../../projection/types";
import type { Item } from "./board";
import { BOARD, commitItems, mountBoard, Transform } from "./board";
import type { MockWorld } from "./mock-world";
import { createMockWorld } from "./mock-world";

// ---------------------------------------------------------------------------
// Unit test: the keyed elements a plugin above registers (`ui`), the view handle
// it asks for and the rest pose it records for them.
// ---------------------------------------------------------------------------

const UI: Owner = { kind: "plugin", name: "ui" };
const OTHER: Owner = { kind: "plugin", name: "text" };

describe("projection registerKey", () => {
  it("answers a registered key through entityOf and keyOf", () => {
    const world = createMockWorld();
    const entity = world.api.ecs.spawn(UI, [Transform()]);

    world.api.projection.registerKey("hud", "coins", entity);

    expect(world.api.projection.entityOf("hud", "coins")).toBe(entity);
    expect(world.api.projection.keyOf(entity)).toEqual({ projection: "hud", key: "coins" });
  });

  it("drops the key with the remover, and calling it twice is a no-op", () => {
    const world = createMockWorld();
    const entity = world.api.ecs.spawn(UI, [Transform()]);
    const drop = world.api.projection.registerKey("hud", "coins", entity);

    drop();
    drop();

    expect(world.api.projection.entityOf("hud", "coins")).toBeUndefined();
    expect(world.api.projection.keyOf(entity)).toBeUndefined();
  });

  it("refuses a key that a live view already holds, naming the projection and the key", () => {
    const world = createMockWorld();

    mountBoard(world, [{ id: "a", level: 1, x: 0, y: 0 }]);

    const element = world.api.ecs.spawn(UI, [Transform()]);

    expect(() => world.api.projection.registerKey(BOARD, "a", element)).toThrow(
      `[game] Key "a" of projection "${BOARD}" is already a live view.\n  Register the element under another key.`
    );
    expect(world.api.projection.entityOf(BOARD, "a")).not.toBe(element);
  });

  it("leaves the live views of a projection in front of a registered key", () => {
    const world = createMockWorld();

    mountBoard(world, [{ id: "a", level: 1, x: 0, y: 0 }]);

    const element = world.api.ecs.spawn(UI, [Transform()]);
    const view = world.api.projection.entityOf(BOARD, "a") ?? 0;

    world.api.projection.registerKey(BOARD, "b", element);

    expect(world.api.projection.entityOf(BOARD, "a")).toBe(view);
    expect(world.api.projection.entityOf(BOARD, "b")).toBe(element);
  });
});

describe("projection viewOf", () => {
  it("refuses a foreign owner, a projection view and an entity that is gone", () => {
    const world = createMockWorld();

    mountBoard(world, [{ id: "a", level: 1, x: 0, y: 0 }]);

    const element = world.api.ecs.spawn(UI, [Transform()]);
    const view = world.api.projection.entityOf(BOARD, "a") ?? 0;

    expect(world.api.projection.viewOf(element, OTHER)).toBeUndefined();
    expect(world.api.projection.viewOf(view, UI)).toBeUndefined();
    expect(world.api.projection.viewOf(999, UI)).toBeUndefined();
    expect(world.api.projection.viewOf(element, UI)).toBeDefined();
  });

  it("carries the entity, the registered key and a peer that answers nothing", () => {
    const world = createMockWorld();
    const entity = world.api.ecs.spawn(UI, [Transform()]);

    world.api.projection.registerKey("hud", "coins", entity);

    const handle = world.api.projection.viewOf(entity, UI);

    expect(handle?.entity).toBe(entity);
    expect(handle?.key).toBe("coins");
    expect(handle?.peer("coins")).toBeUndefined();
  });

  it("sets, tweens and groups motions on the entity of the element", () => {
    const world = createMockWorld();
    const entity = world.api.ecs.spawn(UI, [Transform()]);
    const handle = world.api.projection.viewOf(entity, UI);
    const motions: MotionHandle[] = [];

    handle?.set(Transform, { y: 12 });
    expect(handle?.get(Transform)).toEqual({ x: 0, y: 12, scale: 1 });

    if (handle !== undefined) {
      motions.push(handle.all([handle.tween(Transform, { x: 100 }, { ms: 100, ease: "linear" })]));
    }

    expect(motions[0]?.active()).toBe(true);

    world.frame(50);
    expect(world.api.ecs.get(entity, Transform)?.x).toBe(50);

    motions[0]?.finish();
    expect(world.api.ecs.get(entity, Transform)?.x).toBe(100);
    expect(motions[0]?.active()).toBe(false);
  });

  it("answers undefined from rest until setRest records a pose, then tweens back to it", () => {
    const world = createMockWorld();
    const entity = world.api.ecs.spawn(UI, [Transform()]);
    const handle = world.api.projection.viewOf(entity, UI);

    expect(handle?.rest(Transform)).toBeUndefined();

    world.api.projection.setRest(entity, Transform, { x: 40, y: 80, scale: 1 });
    expect(handle?.rest(Transform)).toEqual({ x: 40, y: 80, scale: 1 });

    world.api.ecs.set(entity, Transform, { x: 0, y: 0 });
    handle?.toRest(Transform, { ms: 100, ease: "linear" });
    world.frame(100);

    expect(world.api.ecs.get(entity, Transform)).toEqual({ x: 40, y: 80, scale: 1 });
  });

  it("ignores a rest pose recorded for an entity that is gone", () => {
    const world = createMockWorld();

    expect(() =>
      world.api.projection.setRest(999, Transform, { x: 1, y: 2, scale: 1 })
    ).not.toThrow();
    expect(world.api.projection.viewOf(999, UI)).toBeUndefined();
  });
});

describe("projection restOf", () => {
  it("answers the recorded rest of an element and undefined before setRest", () => {
    const world = createMockWorld();
    const entity = world.api.ecs.spawn(UI, [Transform()]);

    expect(world.api.projection.restOf(entity, Transform)).toBeUndefined();

    world.api.projection.setRest(entity, Transform, { x: 40, y: 120, scale: 1 });

    expect(world.api.projection.restOf(entity, Transform)).toEqual({ x: 40, y: 120, scale: 1 });
    expect(world.api.projection.restOf(999, Transform)).toBeUndefined();
  });
});

/**
 * Reads the entity of every given key of the board, in the given order.
 *
 * @param world - The mock world.
 * @param keys - The model keys.
 * @returns The entities, `0` for a key with no view.
 */
function entitiesOfKeys(world: MockWorld, keys: readonly string[]): number[] {
  return keys.map(key => world.api.projection.entityOf(BOARD, key) ?? 0);
}

describe("projection entitiesOf", () => {
  const flyAway: ProjectionMotion<Item> = {
    exit: view => view.tween(Transform, { x: 900 }, { ms: 1000, ease: "linear" })
  };

  it("answers the live views of a mounted projection in the order of its keys", () => {
    const world = createMockWorld();

    mountBoard(world, [
      { id: "a", level: 1, x: 0, y: 0 },
      { id: "b", level: 1, x: 80, y: 0 }
    ]);

    expect(world.api.projection.entitiesOf(BOARD)).toEqual(entitiesOfKeys(world, ["a", "b"]));
  });

  it("lists a new item after a commit, at its place in the key order", () => {
    const world = createMockWorld();

    mountBoard(world, [
      { id: "a", level: 1, x: 0, y: 0 },
      { id: "b", level: 1, x: 80, y: 0 }
    ]);
    commitItems(world, [
      { id: "c", level: 1, x: 160, y: 0 },
      { id: "a", level: 1, x: 0, y: 0 },
      { id: "b", level: 1, x: 80, y: 0 }
    ]);
    world.frame(16);

    const listed = world.api.projection.entitiesOf(BOARD);

    expect(listed).toHaveLength(3);
    expect(listed).toEqual(entitiesOfKeys(world, ["c", "a", "b"]));
  });

  it("leaves out a view that is exiting while its exit motion still plays", () => {
    const world = createMockWorld();

    mountBoard(
      world,
      [
        { id: "a", level: 1, x: 0, y: 0 },
        { id: "b", level: 1, x: 80, y: 0 }
      ],
      flyAway
    );

    const [a, b] = entitiesOfKeys(world, ["a", "b"]);

    commitItems(world, [{ id: "b", level: 1, x: 80, y: 0 }]);
    world.frame(16);

    expect(world.api.ecs.has(a ?? 0, Exiting)).toBe(true);
    expect(world.api.projection.entitiesOf(BOARD)).toEqual([b]);
  });

  it("leaves out an element a plugin above registered under the projection name", () => {
    const world = createMockWorld();

    mountBoard(world, [{ id: "a", level: 1, x: 0, y: 0 }]);

    const element = world.api.ecs.spawn(UI, [Transform()]);

    world.api.projection.registerKey(BOARD, "slot", element);

    expect(world.api.projection.entitiesOf(BOARD)).toEqual(entitiesOfKeys(world, ["a"]));
  });

  it("answers an empty list after unmount and for a name that is not mounted", () => {
    const world = createMockWorld();

    mountBoard(world, [{ id: "a", level: 1, x: 0, y: 0 }]);
    world.api.projection.unmount([BOARD]);

    expect(world.api.projection.entitiesOf(BOARD)).toEqual([]);
    expect(world.api.projection.entitiesOf("board.unknown")).toEqual([]);
  });

  it("hands out a copy, so the caller cannot change the view table", () => {
    const world = createMockWorld();

    mountBoard(world, [{ id: "a", level: 1, x: 0, y: 0 }]);

    const first = world.api.projection.entitiesOf(BOARD);

    expect(world.api.projection.entitiesOf(BOARD)).not.toBe(first);
    expect(world.api.projection.entitiesOf(BOARD)).toEqual(first);
  });
});
