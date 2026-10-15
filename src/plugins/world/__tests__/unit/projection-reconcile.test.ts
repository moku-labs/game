import { describe, expect, it, vi } from "vitest";
import { component, Exiting, Tree } from "../../ecs/define";
import type { AnyComponent, Entity, Owner } from "../../ecs/types";
import { projection } from "../../projection/define";
import type {
  AnyProjectionSpec,
  Motion,
  MotionCause,
  MotionHandle,
  ProjectionMotion,
  ViewHandle
} from "../../projection/types";
import type { Item } from "./board";
import {
  BOARD,
  boardItems,
  commitItems,
  expectConverged,
  LAYERS,
  Level,
  MOUNT_OWNER,
  mountBoard,
  restOfName,
  settleFrames,
  storedOf,
  Transform,
  viewOf
} from "./board";
import type { MockWorld } from "./mock-world";
import { createMockWorld } from "./mock-world";

/** The stand-in for the visual of an element: one alpha, as a shape carries it. */
const Fade = component("Fade", { alpha: 1 });

/** The owner of the elements of the tests: a plugin, as `ui` is. */
const ELEMENT_OWNER: Owner = { kind: "plugin", name: "ui" };

/**
 * Starts a track on a view the way a timeline of `anim` does: through the driver, with no handle
 * on the view and no entry in the track list of the projection.
 *
 * @param world - The mock world.
 * @param entity - The entity of the view.
 * @param to - The target fields.
 * @param driven - The component the track drives, `Transform` unless named.
 * @returns The handle of the track, which an aborted node finishes.
 */
function timelineTrack(
  world: MockWorld,
  entity: Entity,
  to: Record<string, number>,
  driven: unknown = Transform
): MotionHandle {
  return world.driver.track(
    entity,
    driven as AnyComponent,
    to,
    { ms: 400, ease: "linear" },
    () => new Set<string>()
  );
}

/**
 * Starts the world with an empty board and spawns one element a plugin owns: a `Transform` and
 * a `Fade`, both with their rest pose recorded, the way `ui` records it.
 *
 * @param world - The mock world.
 * @returns The entity of the element.
 */
function spawnElement(world: MockWorld): Entity {
  mountBoard(world, []);

  const entity = world.api.ecs.spawn(ELEMENT_OWNER, [
    Transform({ x: 10, y: 20, scale: 1 }),
    Fade({ alpha: 1 })
  ]);

  world.api.projection.setRest(entity, Transform, { x: 10, y: 20, scale: 1 });
  world.api.projection.setRest(entity, Fade, { alpha: 1 });

  return entity;
}

describe("projection reconcile", () => {
  it("spawns a view with the projection's layer when a key is new", () => {
    const world = createMockWorld();

    mountBoard(world, [{ id: "a", level: 1, x: 10, y: 20 }]);

    const entity = world.api.projection.entityOf(BOARD, "a") ?? 0;

    expect(world.api.ecs.get(entity, Transform)).toEqual({ x: 10, y: 20, scale: 1 });
    expect(storedOf(world, entity, "Layer")).toEqual({ name: "items" });
    expect(world.api.projection.keyOf(entity)).toEqual({ projection: BOARD, key: "a" });
  });

  it("lets an enter hook read and write its own components in the same call", () => {
    const world = createMockWorld();
    const seen: Array<{ x: number; scale: number }> = [];

    mountBoard(world, [], {
      enter: view => {
        view.set(Transform, { scale: 0 });
        const current = view.get(Transform);

        seen.push({ x: current?.x ?? -1, scale: current?.scale ?? -1 });
      }
    });
    commitItems(world, [{ id: "a", level: 1, x: 10, y: 20 }]);
    world.frame(16);

    expect(seen).toEqual([{ x: 10, scale: 0 }]);
  });

  it("skips an item that is the same object as last time", () => {
    const world = createMockWorld();
    const item: Item = { id: "a", level: 1, x: 0, y: 0 };
    const view = vi.fn(() => [Level({ level: 1 })]);

    world.model.player = { items: [item] };
    world.api.projection.setLayers(LAYERS);
    world.api.projection.register({
      name: BOARD,
      layer: "items",
      from: (player: { items: Item[] }) => player.items,
      key: (found: Item) => found.id,
      view
    });
    world.start();
    world.api.projection.mount([BOARD], MOUNT_OWNER);
    expect(view).toHaveBeenCalledTimes(1);

    world.commit();
    world.frame();

    expect(view).toHaveBeenCalledTimes(1);
  });

  it("ignores a duplicate key and names the projection and the key", () => {
    const world = createMockWorld();

    mountBoard(world, [
      { id: "a", level: 1, x: 1, y: 0 },
      { id: "a", level: 5, x: 9, y: 0 }
    ]);

    const entity = world.api.projection.entityOf(BOARD, "a") ?? 0;

    expect(world.api.ecs.get(entity, Level)).toEqual({ level: 1 });
    expect(world.log.warn).toHaveBeenCalledWith(
      "world:duplicate-key",
      expect.objectContaining({ projection: BOARD, key: "a" })
    );
  });

  it("logs a throwing view and skips that projection for this reconcile", () => {
    const world = createMockWorld();

    world.model.player = { items: [{ id: "a" }] };
    world.api.projection.setLayers(LAYERS);
    world.api.projection.register({
      name: BOARD,
      layer: "items",
      from: (player: { items: { id: string }[] }) => player.items,
      key: (item: { id: string }) => item.id,
      view: () => {
        throw new Error("boom");
      }
    });
    world.start();

    expect(() => world.api.projection.mount([BOARD], MOUNT_OWNER)).not.toThrow();
    expect(world.api.projection.entityOf(BOARD, "a")).toBeUndefined();
    expect(world.log.error).toHaveBeenCalled();
  });

  it("makes one reconcile out of two commits in one frame", () => {
    const world = createMockWorld({ reconciledEvent: true });

    mountBoard(world, [{ id: "a", level: 1, x: 0, y: 0 }]);
    world.emitted.length = 0;

    commitItems(world, [{ id: "a", level: 2, x: 0, y: 0 }]);
    commitItems(world, [{ id: "a", level: 3, x: 0, y: 0 }]);
    world.frame();

    expect(world.emitted).toHaveLength(1);
    expect(world.api.ecs.get(world.api.projection.entityOf(BOARD, "a") ?? 0, Level)).toEqual({
      level: 3
    });
  });

  it("skips a commit that touched neither player nor session", () => {
    const world = createMockWorld({ reconciledEvent: true });

    mountBoard(world, [{ id: "a", level: 1, x: 0, y: 0 }]);
    world.emitted.length = 0;

    world.commit("edge", ["rng"]);
    world.frame();

    expect(world.emitted).toHaveLength(0);
  });

  it("emits world:reconciled only when the config asks for it", () => {
    const world = createMockWorld();

    mountBoard(world, [{ id: "a", level: 1, x: 0, y: 0 }]);
    commitItems(world, [{ id: "a", level: 2, x: 0, y: 0 }]);
    world.frame();

    expect(world.emitted).toHaveLength(0);
  });

  it("plays motions on an edge and writes directly on a load", () => {
    const world = createMockWorld();
    const played: string[] = [];

    mountBoard(world, [{ id: "a", level: 1, x: 0, y: 0 }], {
      change: {
        Transform: view => {
          played.push("change");

          return view.toRest(Transform, { ms: 100 });
        }
      }
    });

    commitItems(world, [{ id: "a", level: 1, x: 100, y: 0 }]);
    world.frame();
    expect(played).toEqual(["change"]);

    const entity = world.api.projection.entityOf(BOARD, "a") ?? 0;

    expect(world.api.ecs.get(entity, Transform)?.x).toBeLessThan(100);

    world.model.player = { items: [{ id: "a", level: 1, x: 200, y: 0 }] };
    world.commit("load", ["player"]);
    world.frame();

    expect(world.api.ecs.get(entity, Transform)).toEqual({ x: 200, y: 0, scale: 1 });
    expectConverged(world, "a");
  });

  it("brings a view home in one frame on a load, also a component no diff names", () => {
    const world = createMockWorld();

    mountBoard(world, [{ id: "a", level: 1, x: 0, y: 0 }], {
      change: {
        Transform: view => view.tween(Transform, { scale: 1.4 }, { ms: 400, ease: "linear" })
      }
    });

    const entity = world.api.projection.entityOf(BOARD, "a") ?? 0;

    commitItems(world, [{ id: "a", level: 1, x: 200, y: 0 }]);
    world.frame(16);
    world.frame(100);

    expect(world.api.ecs.get(entity, Transform)?.scale).toBeGreaterThan(1);
    expect(world.api.ecs.get(entity, Transform)?.x).toBe(0);

    world.model.player = { items: [{ id: "a", level: 1, x: 200, y: 0 }] };
    world.commit("load", ["player"]);
    world.frame(16);

    expect(world.api.ecs.get(entity, Transform)).toEqual({ x: 200, y: 0, scale: 1 });
    expect(world.log.warn).not.toHaveBeenCalledWith("world:view-corrected", expect.anything());
    expectConverged(world, "a");
  });

  it("rerunAll forces the view of every item and writes directly", () => {
    const world = createMockWorld();
    let label = "one";
    const item: Item = { id: "a", level: 1, x: 0, y: 0 };

    world.model.player = { items: [item] };
    world.api.projection.setLayers(LAYERS);
    world.api.projection.register({
      name: BOARD,
      layer: "items",
      from: (player: { items: Item[] }) => player.items,
      key: (found: Item) => found.id,
      view: () => [Level({ level: label === "one" ? 1 : 7 })]
    });
    world.start();
    world.api.projection.mount([BOARD], MOUNT_OWNER);

    label = "two";
    world.api.projection.rerunAll();
    world.frame();

    const entity = world.api.projection.entityOf(BOARD, "a") ?? 0;

    expect(world.api.ecs.get(entity, Level)).toEqual({ level: 7 });
  });

  it("reconciles inside the handler in fast mode, with no frame and no track", () => {
    const world = createMockWorld();

    mountBoard(world, [{ id: "a", level: 1, x: 0, y: 0 }], {
      change: { Transform: view => view.toRest(Transform, { ms: 300 }) }
    });

    world.flow.mode = "fast";
    commitItems(world, [{ id: "a", level: 1, x: 300, y: 0 }]);

    const entity = world.api.projection.entityOf(BOARD, "a") ?? 0;

    expect(world.api.ecs.get(entity, Transform)).toEqual({ x: 300, y: 0, scale: 1 });
    expect(world.ctx.state.projection.tracks.some(track => track.handle.active())).toBe(false);
  });

  it("keeps the mute remover safe after the entity left", () => {
    const world = createMockWorld();

    mountBoard(world, [{ id: "a", level: 1, x: 0, y: 0 }]);

    const entity = world.api.projection.entityOf(BOARD, "a") ?? 0;
    const release = world.api.projection.mute(entity, Transform, ["x"]);

    commitItems(world, []);
    world.frame();

    expect(() => release()).not.toThrow();
    expect(() => release()).not.toThrow();
  });

  it("delays lift(false) until the last motion of the view ended", () => {
    const world = createMockWorld();

    mountBoard(world, [{ id: "a", level: 1, x: 0, y: 0 }], {
      change: { Transform: view => view.toRest(Transform, { ms: 100 }) }
    });

    const entity: Entity = world.api.projection.entityOf(BOARD, "a") ?? 0;

    world.api.projection.lift(entity, true);
    expect(storedOf(world, entity, "Layer")).toEqual({ name: "lifted" });

    commitItems(world, [{ id: "a", level: 1, x: 90, y: 0 }]);
    world.frame();
    world.api.projection.lift(entity, false);

    expect(storedOf(world, entity, "Layer")).toEqual({ name: "lifted" });

    settleFrames(world);

    expect(storedOf(world, entity, "Layer")).toEqual({ name: "items" });
    expectConverged(world, "a");
  });

  it("despawns a view that left and never tags a live one Exiting", () => {
    const world = createMockWorld();

    mountBoard(world, [{ id: "a", level: 1, x: 0, y: 0 }]);

    const entity = world.api.projection.entityOf(BOARD, "a") ?? 0;

    expect(world.api.ecs.has(entity, Exiting)).toBe(false);

    commitItems(world, []);
    world.frame();

    expect(world.api.projection.entityOf(BOARD, "a")).toBeUndefined();
    expect(viewOf(world, "a")).toBeUndefined();
    expect(world.api.ecs.has(entity, Transform)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// A restore and a load replace the state: every live view stands on its rest pose
// after the reconcile, also a view whose item is the very same object as before.
// ---------------------------------------------------------------------------

describe("projection reconcile — a restore and a load converge every view", () => {
  it.each([
    "restore",
    "load"
  ] as const)("brings an unchanged item home on a %s, after a motion of the view left it off its rest pose", cause => {
    const world = createMockWorld();

    mountBoard(world, [{ id: "a", level: 1, x: 0, y: 0 }], {
      change: {
        Transform: view => view.tween(Transform, { scale: 1.4 }, { ms: 400, ease: "linear" })
      }
    });

    const entity = world.api.projection.entityOf(BOARD, "a") ?? 0;

    commitItems(world, [{ id: "a", level: 1, x: 200, y: 0 }]);
    world.frame(16);
    world.frame(100);

    expect(world.api.ecs.get(entity, Transform)?.scale).toBeGreaterThan(1);

    // The state did not move: `from` hands out the very same item object.
    world.commit(cause, ["player"]);
    world.frame(16);

    expect(world.api.ecs.get(entity, Transform)).toEqual({ x: 200, y: 0, scale: 1 });
    expectConverged(world, "a");
  });

  it.each([
    "restore",
    "load"
  ] as const)("brings an unchanged item home on a %s, after a finished timeline left it on its end pose", cause => {
    const world = createMockWorld();
    const view = vi.fn((item: Item) => [Transform({ x: item.x, y: item.y, scale: 1 })]);

    world.model.player = { items: [{ id: "a", level: 1, x: 10, y: 20 }] };
    world.api.projection.setLayers(LAYERS);
    world.api.projection.register({
      name: BOARD,
      layer: "items",
      from: (player: { items: Item[] }) => player.items,
      key: (found: Item) => found.id,
      view
    });
    world.start();
    world.api.projection.mount([BOARD], MOUNT_OWNER);

    const entity = world.api.projection.entityOf(BOARD, "a") ?? 0;
    const flight = timelineTrack(world, entity, { y: -900 });

    world.frame(100);
    // The node was aborted: `anim` finishes its timeline, the view stands off the screen.
    flight.finish();

    expect(world.api.ecs.get(entity, Transform)).toEqual({ x: 10, y: -900, scale: 1 });

    world.commit(cause, ["player"]);
    world.frame(16);

    expect(world.api.ecs.get(entity, Transform)).toEqual({ x: 10, y: 20, scale: 1 });
    expectConverged(world, "a");
    // The rest pose is written, `view` does not run again for the same item.
    expect(view).toHaveBeenCalledTimes(1);
  });

  it("ends a track that still runs on an unchanged item, and nothing writes after the restore", () => {
    const world = createMockWorld();

    mountBoard(world, [{ id: "a", level: 1, x: 10, y: 20 }]);

    const entity = world.api.projection.entityOf(BOARD, "a") ?? 0;
    const flight = timelineTrack(world, entity, { y: -900 });

    world.frame(100);

    expect(world.api.ecs.get(entity, Transform)?.y).toBeLessThan(20);

    world.commit("restore", ["player"]);
    world.frame(16);

    expect(flight.active()).toBe(false);
    expect(world.driver.active()).toBe(0);
    expect(world.api.ecs.get(entity, Transform)).toEqual({ x: 10, y: 20, scale: 1 });

    world.frame(100);

    expect(world.api.ecs.get(entity, Transform)).toEqual({ x: 10, y: 20, scale: 1 });
    expect(world.log.warn).not.toHaveBeenCalledWith("world:view-corrected", expect.anything());
  });

  it("leaves the fields the hand owns where they are on a restore", () => {
    const world = createMockWorld();

    mountBoard(world, [{ id: "a", level: 1, x: 10, y: 20 }]);

    const entity = world.api.projection.entityOf(BOARD, "a") ?? 0;

    world.api.projection.mute(entity, Transform, ["x"]);
    world.api.ecs.set(entity, Transform, { x: 77, y: -900 });

    world.commit("restore", ["player"]);
    world.frame(16);

    expect(world.api.ecs.get(entity, Transform)).toEqual({ x: 77, y: 20, scale: 1 });
  });

  it("touches nothing of an unchanged item on an edge: the pose stays and the track runs on", () => {
    const world = createMockWorld();
    const view = vi.fn((item: Item) => [Transform({ x: item.x, y: item.y, scale: 1 })]);

    world.model.player = { items: [{ id: "a", level: 1, x: 10, y: 20 }] };
    world.api.projection.setLayers(LAYERS);
    world.api.projection.register({
      name: BOARD,
      layer: "items",
      from: (player: { items: Item[] }) => player.items,
      key: (found: Item) => found.id,
      view
    });
    world.start();
    world.api.projection.mount([BOARD], MOUNT_OWNER);

    const entity = world.api.projection.entityOf(BOARD, "a") ?? 0;

    timelineTrack(world, entity, { y: -900 }).finish();

    const flight = timelineTrack(world, entity, { x: 500 });

    world.commit("edge", ["player"]);
    world.frame(100);

    expect(flight.active()).toBe(true);
    expect(world.api.ecs.get(entity, Transform)).toEqual({ x: 132.5, y: -900, scale: 1 });
    expect(view).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// The same for an element a plugin owns: `ui` records its rest pose with `setRest`,
// and no reconcile of a projection ever meets it.
// ---------------------------------------------------------------------------

describe("projection reconcile — a restore and a load converge every element with a rest pose", () => {
  it.each([
    "restore",
    "load"
  ] as const)("brings an element home on a %s, after a finished timeline left it on its end pose", cause => {
    const world = createMockWorld();
    const entity = spawnElement(world);

    timelineTrack(world, entity, { y: -900 }).finish();
    timelineTrack(world, entity, { alpha: 0 }, Fade).finish();

    expect(world.api.ecs.get(entity, Transform)).toEqual({ x: 10, y: -900, scale: 1 });
    expect(world.api.ecs.get(entity, Fade)).toEqual({ alpha: 0 });

    world.commit(cause, ["player"]);
    world.frame(16);

    expect(world.api.ecs.get(entity, Transform)).toEqual({ x: 10, y: 20, scale: 1 });
    expect(world.api.ecs.get(entity, Fade)).toEqual({ alpha: 1 });
    expect(world.driver.active()).toBe(0);
  });

  it("ends a track that still runs on an element, and nothing writes after the restore", () => {
    const world = createMockWorld();
    const entity = spawnElement(world);
    const flight = timelineTrack(world, entity, { y: -900 });
    const fade = world.api.projection
      .viewOf(entity, ELEMENT_OWNER)
      ?.tween(Fade, { alpha: 0 }, { ms: 400, ease: "linear" });

    world.frame(100);

    expect(world.api.ecs.get(entity, Transform)?.y).toBeLessThan(20);
    expect(world.api.ecs.get(entity, Fade)?.alpha).toBeLessThan(1);

    world.commit("restore", ["player"]);
    world.frame(16);

    expect(flight.active()).toBe(false);
    expect(fade?.active()).toBe(false);
    expect(world.driver.active()).toBe(0);
    expect(world.api.projection.motionsOf(entity)).toEqual([]);
    expect(world.api.ecs.get(entity, Transform)).toEqual({ x: 10, y: 20, scale: 1 });
    expect(world.api.ecs.get(entity, Fade)).toEqual({ alpha: 1 });

    world.frame(100);

    expect(world.api.ecs.get(entity, Transform)).toEqual({ x: 10, y: 20, scale: 1 });
    expect(world.api.ecs.get(entity, Fade)).toEqual({ alpha: 1 });
  });

  it("touches nothing of an element on an edge: the pose stays and the track runs on", () => {
    const world = createMockWorld();
    const entity = spawnElement(world);

    timelineTrack(world, entity, { alpha: 0 }, Fade).finish();

    const flight = timelineTrack(world, entity, { y: -380 });

    world.commit("edge", ["player"]);
    world.frame(100);

    expect(flight.active()).toBe(true);
    expect(world.api.ecs.get(entity, Transform)).toEqual({ x: 10, y: -80, scale: 1 });
    expect(world.api.ecs.get(entity, Fade)).toEqual({ alpha: 0 });
  });

  it("leaves the fields another writer owns on an element where they are", () => {
    const world = createMockWorld();
    const entity = spawnElement(world);

    world.api.projection.mute(entity, Transform, ["y"]);
    world.api.ecs.set(entity, Transform, { x: 500, y: -240 });

    world.commit("restore", ["player"]);
    world.frame(16);

    expect(world.api.ecs.get(entity, Transform)).toEqual({ x: 10, y: -240, scale: 1 });
  });

  it("does not add a rest component the element no longer carries", () => {
    const world = createMockWorld();
    const entity = spawnElement(world);

    world.api.ecs.remove(entity, Fade);
    world.api.ecs.set(entity, Transform, { y: -900 });

    world.commit("restore", ["player"]);
    world.frame(16);

    expect(world.api.ecs.has(entity, Fade)).toBe(false);
    expect(world.api.ecs.get(entity, Transform)).toEqual({ x: 10, y: 20, scale: 1 });
  });

  it("skips the recorded rest pose of an entity that is gone", () => {
    const world = createMockWorld();
    const entity = spawnElement(world);
    const other = world.api.ecs.spawn(ELEMENT_OWNER, [Transform({ x: 1, y: 2, scale: 1 })]);

    world.api.projection.setRest(other, Transform, { x: 1, y: 2, scale: 1 });
    world.api.ecs.set(other, Transform, { y: -900 });
    world.api.ecs.despawn(entity);

    world.commit("restore", ["player"]);

    expect(() => world.frame(16)).not.toThrow();
    expect(world.api.ecs.has(entity, Transform)).toBe(false);
    expect(world.api.ecs.get(other, Transform)).toEqual({ x: 1, y: 2, scale: 1 });
    expect(world.log.error).not.toHaveBeenCalled();
  });

  it("lets the rest pose of a projection view win over one recorded for its entity", () => {
    const world = createMockWorld();

    mountBoard(world, [{ id: "a", level: 1, x: 10, y: 20 }]);

    const entity = world.api.projection.entityOf(BOARD, "a") ?? 0;

    world.api.projection.setRest(entity, Transform, { x: 700, y: 700, scale: 2 });
    world.api.ecs.set(entity, Transform, { y: -900 });

    world.commit("restore", ["player"]);
    world.frame(16);

    expect(world.api.ecs.get(entity, Transform)).toEqual({ x: 10, y: 20, scale: 1 });
  });

  it("ends the tracks of an element that is leaving and does not bring it back", () => {
    const world = createMockWorld();
    const entity = spawnElement(world);

    world.api.ecs.tag(entity, Exiting);

    const exit = timelineTrack(world, entity, { y: -900 });

    world.frame(100);

    const left = world.api.ecs.get(entity, Transform)?.y;

    world.commit("restore", ["player"]);
    world.frame(16);

    expect(exit.active()).toBe(false);
    expect(left).toBeLessThan(20);
    expect(world.api.ecs.get(entity, Transform)?.y).toBe(left);
  });

  it("tells the owner once the elements are home and every track on them is ended", () => {
    const world = createMockWorld();
    const entity = spawnElement(world);
    const seen: Array<{ y: number | undefined; tracks: number }> = [];
    const off = world.api.projection.onConverged(() => {
      seen.push({ y: world.api.ecs.get(entity, Transform)?.y, tracks: world.driver.active() });
    });

    timelineTrack(world, entity, { y: -900 });
    world.frame(100);

    world.commit("edge", ["player"]);
    world.frame(16);

    expect(seen).toEqual([]);

    world.commit("restore", ["player"]);
    world.frame(16);

    expect(seen).toEqual([{ y: 20, tracks: 0 }]);

    off();
    world.commit("load", ["player"]);
    world.frame(16);

    expect(seen).toHaveLength(1);
  });

  it("logs a listener that throws and still calls the next one", () => {
    const world = createMockWorld();
    const called: string[] = [];

    spawnElement(world);
    world.api.projection.onConverged(() => {
      throw new Error("bad owner");
    });
    world.api.projection.onConverged(() => {
      called.push("second");
    });

    world.commit("restore", ["player"]);

    expect(() => world.frame(16)).not.toThrow();
    expect(called).toEqual(["second"]);
    expect(world.log.error).toHaveBeenCalledWith(
      "world:converged-listener-failed",
      expect.anything(),
      expect.any(Error)
    );
  });
});

// ---------------------------------------------------------------------------
// F1. A rollback commits the state of the last rest point, so `from` hands out the
// same item objects. A view the failed node moved is settled, as `settle(entity)` does.
// ---------------------------------------------------------------------------

describe("projection reconcile — F1: a rollback settles a view that stands off its rest pose", () => {
  it("settles an unchanged item whose own motion left it off its rest pose", () => {
    const world = createMockWorld();
    const handles: MotionHandle[] = [];
    const settle = vi.fn((view: ViewHandle<Item>, components: readonly string[]) =>
      view.all(components.map(name => restOfName(view, name)))
    );

    mountBoard(world, [{ id: "a", level: 1, x: 0, y: 0 }], {
      change: {
        Transform: view => {
          const handle = view.tween(Transform, { scale: 1.4 }, { ms: 400, ease: "linear" });

          handles.push(handle);

          return handle;
        }
      },
      settle
    });

    const entity = world.api.projection.entityOf(BOARD, "a") ?? 0;

    commitItems(world, [{ id: "a", level: 1, x: 200, y: 0 }]);
    world.frame(16);
    world.frame(100);

    expect(world.api.ecs.get(entity, Transform)?.scale).toBeGreaterThan(1);
    expect(settle).not.toHaveBeenCalled();

    // The failed node committed nothing: `from` hands out the very same item object.
    world.commit("rollback", ["player"]);
    world.frame(16);

    expect(handles[0]?.active()).toBe(false);
    expect(settle).toHaveBeenCalledTimes(1);
    expect(settle.mock.calls[0]?.[1]).toEqual(["Transform"]);

    settleFrames(world);

    expect(world.api.ecs.get(entity, Transform)).toEqual({ x: 200, y: 0, scale: 1 });
    expect(world.log.warn).not.toHaveBeenCalledWith("world:view-corrected", expect.anything());
    expectConverged(world, "a");
  });

  it("settles an unchanged item a finished timeline left on its end pose, with the built-in toRest", () => {
    const world = createMockWorld();
    const view = vi.fn((item: Item) => [Transform({ x: item.x, y: item.y, scale: 1 })]);

    world.model.player = { items: [{ id: "a", level: 1, x: 10, y: 20 }] };
    world.api.projection.setLayers(LAYERS);
    world.api.projection.register({
      name: BOARD,
      layer: "items",
      from: (player: { items: Item[] }) => player.items,
      key: (found: Item) => found.id,
      view
    });
    world.start();
    world.api.projection.mount([BOARD], MOUNT_OWNER);

    const entity = world.api.projection.entityOf(BOARD, "a") ?? 0;

    // The node awaited its timeline and then threw: the view stands on the end pose.
    timelineTrack(world, entity, { y: -900 }).finish();

    expect(world.api.ecs.get(entity, Transform)).toEqual({ x: 10, y: -900, scale: 1 });

    world.commit("rollback", ["player"]);
    world.frame(16);

    const y = world.api.ecs.get(entity, Transform)?.y ?? 0;

    expect(world.driver.started.at(-1)).toMatchObject({
      entity,
      component: "Transform",
      to: { x: 10, y: 20, scale: 1 },
      options: { ms: 350 }
    });
    expect(y).toBeGreaterThan(-900);
    expect(y).toBeLessThan(20);

    settleFrames(world);

    expect(world.api.ecs.get(entity, Transform)).toEqual({ x: 10, y: 20, scale: 1 });
    expectConverged(world, "a");
    // The settle is a motion, `view` does not run again for the same item.
    expect(view).toHaveBeenCalledTimes(1);
  });

  it("leaves an unchanged view that stands on its rest pose alone: its motion runs on", () => {
    const world = createMockWorld();
    const handles: MotionHandle[] = [];
    const settle = vi.fn((view: ViewHandle<Item>, components: readonly string[]) =>
      view.all(components.map(name => restOfName(view, name)))
    );

    mountBoard(world, [{ id: "a", level: 1, x: 0, y: 0 }], {
      change: {
        Transform: (view, _previous, next) => {
          view.set(Transform, { x: next.x });

          // A pulse that ends where it starts: the view is home while it runs.
          const handle = view.tween(Transform, { scale: 1 }, { ms: 400, ease: "linear" });

          handles.push(handle);

          return handle;
        }
      },
      settle
    });

    commitItems(world, [{ id: "a", level: 1, x: 50, y: 0 }]);
    world.frame(16);

    const started = world.driver.started.length;

    world.commit("rollback", ["player"]);
    world.frame(16);

    expect(handles[0]?.active()).toBe(true);
    expect(settle).not.toHaveBeenCalled();
    expect(world.driver.started).toHaveLength(started);
  });

  it("still skips an unchanged view that stands off its rest pose on an edge", () => {
    const world = createMockWorld();
    const settle = vi.fn((view: ViewHandle<Item>, components: readonly string[]) =>
      view.all(components.map(name => restOfName(view, name)))
    );

    mountBoard(world, [{ id: "a", level: 1, x: 10, y: 20 }], { settle });

    const entity = world.api.projection.entityOf(BOARD, "a") ?? 0;

    timelineTrack(world, entity, { y: -900 }).finish();

    world.commit("edge", ["player"]);
    world.frame(16);
    world.frame(100);

    expect(settle).not.toHaveBeenCalled();
    expect(world.api.ecs.get(entity, Transform)).toEqual({ x: 10, y: -900, scale: 1 });
  });

  it.each([
    ["paused", (world: MockWorld): void => world.api.ecs.setMode("paused")],
    [
      "fast",
      (world: MockWorld): void => {
        world.flow.mode = "fast";
      }
    ]
  ] as const)("writes the rest pose at once on a rollback while the world is %s", (_mode, enter) => {
    const world = createMockWorld();

    mountBoard(world, [{ id: "a", level: 1, x: 10, y: 20 }]);

    const entity = world.api.projection.entityOf(BOARD, "a") ?? 0;

    timelineTrack(world, entity, { y: -900 }).finish();
    enter(world);

    const started = world.driver.started.length;

    world.commit("rollback", ["player"]);
    world.frame(16);

    expect(world.api.ecs.get(entity, Transform)).toEqual({ x: 10, y: 20, scale: 1 });
    expect(world.driver.started).toHaveLength(started);
    expect(world.driver.active()).toBe(0);
  });

  it("writes the rest pose after the flush finished the motion of the view, in direct mode", () => {
    const world = createMockWorld();

    mountBoard(world, [{ id: "a", level: 1, x: 0, y: 0 }], {
      change: {
        Transform: view => view.tween(Transform, { scale: 1.4 }, { ms: 400, ease: "linear" })
      }
    });

    const entity = world.api.projection.entityOf(BOARD, "a") ?? 0;

    commitItems(world, [{ id: "a", level: 1, x: 200, y: 0 }]);
    world.frame(16);
    world.frame(100);

    world.api.ecs.setMode("paused");
    world.commit("rollback", ["player"]);
    world.frame(16);

    // The flush finished the tween on scale 1.4. The rest pose is written after it.
    expect(world.api.ecs.get(entity, Transform)).toEqual({ x: 200, y: 0, scale: 1 });
    expect(world.driver.active()).toBe(0);
  });

  it("writes the rest pose after the flush, so a track that writes when it is cancelled does not win", () => {
    const world = createMockWorld();

    mountBoard(world, [{ id: "a", level: 1, x: 10, y: 20 }]);

    const entity = world.api.projection.entityOf(BOARD, "a") ?? 0;

    // An additive track of `anim` writes its base back when the flush cancels it.
    world.offDriver();
    world.api.projection.setDriver({
      track: world.driver.track,
      cancelAll: (target: Entity): void => {
        world.driver.cancelAll(target);
        world.api.ecs.set(target, Transform, { y: -900 });
      }
    });

    world.api.ecs.set(entity, Transform, { y: -400 });
    world.api.ecs.setMode("paused");
    world.commit("rollback", ["player"]);
    world.frame(16);

    expect(world.api.ecs.get(entity, Transform)).toEqual({ x: 10, y: 20, scale: 1 });
  });

  it("writes nothing on a direct rollback for a view that stands on its rest pose", () => {
    const world = createMockWorld();

    mountBoard(world, [{ id: "a", level: 1, x: 10, y: 20 }]);
    // One frame clears the change set the mount left.
    world.frame(16);

    // Fast mode reconciles inside the handler: no frame clears the change set after it.
    world.flow.mode = "fast";
    world.commit("rollback", ["player"]);

    expect([...world.api.ecs.changed(Transform)]).toEqual([]);
  });

  it("does not count a field the hand owns as off the rest pose", () => {
    const world = createMockWorld();

    mountBoard(world, [{ id: "a", level: 1, x: 10, y: 20 }]);

    const entity = world.api.projection.entityOf(BOARD, "a") ?? 0;

    world.api.projection.mute(entity, Transform, ["x", "y"]);
    world.api.ecs.set(entity, Transform, { x: 77, y: 300 });

    const started = world.driver.started.length;

    world.commit("rollback", ["player"]);
    world.frame(16);
    world.frame(100);

    expect(world.driver.started).toHaveLength(started);
    expect(world.api.ecs.get(entity, Transform)).toEqual({ x: 77, y: 300, scale: 1 });
  });

  it("leaves an element another plugin owns where it is: only views are settled", () => {
    const world = createMockWorld();
    const entity = spawnElement(world);

    timelineTrack(world, entity, { y: -900 }).finish();

    world.commit("rollback", ["player"]);
    world.frame(16);
    world.frame(100);

    expect(world.api.ecs.get(entity, Transform)).toEqual({ x: 10, y: -900, scale: 1 });
  });
});

// ---------------------------------------------------------------------------
// F2. `lift(false)` on a moving view waits for its last motion. A reconcile that ends
// the motions itself applies the drop: the sweep skips a view that holds no handle.
// ---------------------------------------------------------------------------

/**
 * Mounts one item, lifts its view, moves it and asks for the drop while it still moves, so the
 * drop is pending.
 *
 * @param world - The mock world.
 * @returns The entity of the view, still in the lift layer.
 */
function liftAndRelease(world: MockWorld): Entity {
  mountBoard(world, [{ id: "a", level: 1, x: 0, y: 0 }], {
    change: { Transform: view => view.toRest(Transform, { ms: 400 }) }
  });

  const entity = world.api.projection.entityOf(BOARD, "a") ?? 0;

  world.api.projection.lift(entity, true);
  commitItems(world, [{ id: "a", level: 1, x: 90, y: 0 }]);
  world.frame(16);
  world.api.projection.lift(entity, false);

  expect(storedOf(world, entity, "Layer")).toEqual({ name: "lifted" });

  return entity;
}

/**
 * Mounts one item whose `Transform` change writes the new place at once and then plays a pulse
 * that ends where it starts: the view moves, and stands on its rest pose the whole time.
 *
 * @param world - The mock world.
 * @param items - The items the player starts with.
 */
function mountPulsing(world: MockWorld, items: Item[]): void {
  mountBoard(world, items, {
    change: {
      Transform: (view, _previous, next) => {
        view.set(Transform, { x: next.x });

        return view.tween(Transform, { scale: 1 }, { ms: 400, ease: "linear" });
      }
    }
  });
}

describe("projection reconcile — F2: a pending lift(false) survives a reconcile that ends the motions", () => {
  it.each(["load", "restore"] as const)("drops the view on a %s that changes its item", cause => {
    const world = createMockWorld();
    const entity = liftAndRelease(world);

    world.model.player = { items: [{ id: "a", level: 1, x: 200, y: 0 }] };
    world.commit(cause, ["player"]);
    world.frame(16);

    expect(storedOf(world, entity, "Layer")).toEqual({ name: "items" });
    expect(viewOf(world, "a")).toMatchObject({ lifted: false, dropWhenStill: false });
  });

  it("drops the view on a direct reconcile that leaves its item alone", () => {
    const world = createMockWorld();
    const entity = liftAndRelease(world);

    world.api.ecs.setMode("paused");
    world.commit("edge", ["player"]);
    world.frame(16);

    expect(storedOf(world, entity, "Layer")).toEqual({ name: "items" });
    expect(viewOf(world, "a")).toMatchObject({ lifted: false, dropWhenStill: false });
  });

  it("drops the view when the mode turns fast", () => {
    const world = createMockWorld();
    const entity = liftAndRelease(world);

    world.api.ecs.setMode("fast");

    expect(storedOf(world, entity, "Layer")).toEqual({ name: "items" });
  });

  it("keeps a view the finger still holds lifted on a direct reconcile", () => {
    const world = createMockWorld();

    mountBoard(world, [{ id: "a", level: 1, x: 0, y: 0 }], {
      change: { Transform: view => view.toRest(Transform, { ms: 400 }) }
    });

    const entity = world.api.projection.entityOf(BOARD, "a") ?? 0;

    world.api.projection.lift(entity, true);
    commitItems(world, [{ id: "a", level: 1, x: 90, y: 0 }]);
    world.frame(16);

    world.model.player = { items: [{ id: "a", level: 1, x: 200, y: 0 }] };
    world.commit("load", ["player"]);
    world.frame(16);

    expect(storedOf(world, entity, "Layer")).toEqual({ name: "lifted" });
    expect(viewOf(world, "a")).toMatchObject({ lifted: true, dropWhenStill: false });
  });

  it("drops the view in play mode when a change cancels its last motion and nothing is loose", () => {
    const world = createMockWorld();

    mountPulsing(world, [{ id: "a", level: 1, x: 0, y: 0 }]);

    const entity = world.api.projection.entityOf(BOARD, "a") ?? 0;

    world.api.projection.lift(entity, true);
    commitItems(world, [{ id: "a", level: 1, x: 90, y: 0 }]);
    world.frame(16);
    world.api.projection.lift(entity, false);

    expect(storedOf(world, entity, "Layer")).toEqual({ name: "lifted" });

    // `Level` has no hook: it is written directly, the pulse is cancelled, nothing is loose.
    commitItems(world, [{ id: "a", level: 2, x: 90, y: 0 }]);
    world.frame(16);

    expect(world.driver.active()).toBe(0);
    expect(storedOf(world, entity, "Layer")).toEqual({ name: "items" });
    expect(viewOf(world, "a")).toMatchObject({ lifted: false, dropWhenStill: false });
  });

  it("keeps the drop waiting in play mode while the change started a new motion", () => {
    const world = createMockWorld();
    const entity = liftAndRelease(world);

    commitItems(world, [{ id: "a", level: 1, x: 200, y: 0 }]);
    world.frame(16);

    expect(storedOf(world, entity, "Layer")).toEqual({ name: "lifted" });

    settleFrames(world);

    expect(storedOf(world, entity, "Layer")).toEqual({ name: "items" });
  });

  it("keeps a held view lifted in play mode when a change cancels its last motion", () => {
    const world = createMockWorld();

    mountPulsing(world, [{ id: "a", level: 1, x: 0, y: 0 }]);

    const entity = world.api.projection.entityOf(BOARD, "a") ?? 0;

    world.api.projection.lift(entity, true);
    commitItems(world, [{ id: "a", level: 1, x: 90, y: 0 }]);
    world.frame(16);
    commitItems(world, [{ id: "a", level: 2, x: 90, y: 0 }]);
    world.frame(16);

    expect(storedOf(world, entity, "Layer")).toEqual({ name: "lifted" });
  });

  it("drops the view when a rollback cancels its last motion and nothing is loose", () => {
    const world = createMockWorld();

    mountBoard(world, [], {
      // The loop of the view owns `Transform` for as long as the view lives.
      loop: view =>
        view.tween(Transform, { scale: 1 }, { ms: 60_000, ease: "linear", repeat: "forever" }),
      change: {
        Level: (view, _previous, next) => {
          view.set(Level, { level: next.level });

          return view.tween(Level, { level: next.level }, { ms: 400, ease: "linear" });
        }
      }
    });
    commitItems(world, [{ id: "a", level: 1, x: 0, y: 0 }]);
    world.frame(16);

    const entity = world.api.projection.entityOf(BOARD, "a") ?? 0;

    world.api.projection.lift(entity, true);
    commitItems(world, [{ id: "a", level: 2, x: 0, y: 0 }]);
    world.frame(16);
    world.api.projection.lift(entity, false);

    expect(storedOf(world, entity, "Layer")).toEqual({ name: "lifted" });

    // Off its rest pose in a component the loop drives: the settle finds nothing loose.
    world.api.ecs.set(entity, Transform, { y: -900 });
    world.commit("rollback", ["player"]);
    world.frame(16);

    expect(storedOf(world, entity, "Layer")).toEqual({ name: "items" });
  });
});

// ---------------------------------------------------------------------------
// F3. A direct reconcile plays no hook and its flush ends every track of a view, the
// loop too. The view owes its loop, and the sweep starts it once the world is live.
// ---------------------------------------------------------------------------

/**
 * The sway of the tests: additive and repeated forever, on a target that is the rest value, so
 * the fake driver neither ends it within a test nor moves the view off its rest pose.
 *
 * @param view - The handle the `loop` hook was given.
 * @returns The motion of the sway.
 */
function sway(view: ViewHandle<Item>): Motion {
  return view.tween(
    Transform,
    { scale: 1 },
    { ms: 60_000, ease: "linear", additive: true, repeat: "forever" }
  );
}

describe("projection reconcile — F3: the loop of a view runs after a direct reconcile", () => {
  it("starts the loop of a view that entered on a mount, on the first sweep, and never plays enter", () => {
    const world = createMockWorld();
    const loop = vi.fn(sway);
    const enter = vi.fn();

    mountBoard(world, [{ id: "a", level: 1, x: 0, y: 0 }], { enter, loop });

    const entity = world.api.projection.entityOf(BOARD, "a") ?? 0;

    expect(loop).not.toHaveBeenCalled();

    world.frame(16);

    expect(loop).toHaveBeenCalledTimes(1);
    expect(loop.mock.calls[0]?.[0]).toMatchObject({ entity, key: "a" });
    expect(world.driver.active()).toBe(1);
    expect(world.driver.started.at(-1)).toMatchObject({
      entity,
      component: "Transform",
      options: { additive: true, repeat: "forever" }
    });
    expect(enter).not.toHaveBeenCalled();
  });

  it("starts the loop of a view that entered on a load", () => {
    const world = createMockWorld();
    const loop = vi.fn(sway);

    mountBoard(world, [], { loop });

    world.model.player = { items: [{ id: "a", level: 1, x: 0, y: 0 }] };
    world.commit("load", ["player"]);
    world.frame(16);

    expect(loop).toHaveBeenCalledTimes(1);
    expect(world.driver.active()).toBe(1);
  });

  it("starts the owed loop once: later frames do not start it again", () => {
    const world = createMockWorld();
    const loop = vi.fn(sway);

    mountBoard(world, [{ id: "a", level: 1, x: 0, y: 0 }], { loop });

    world.frame(16);
    world.frame(16);
    world.frame(16);

    expect(loop).toHaveBeenCalledTimes(1);
    expect(world.driver.active()).toBe(1);
  });

  it("a play-mode enter starts the loop directly and owes none", () => {
    const world = createMockWorld();
    const loop = vi.fn(sway);

    mountBoard(world, [], { loop });
    commitItems(world, [{ id: "a", level: 1, x: 0, y: 0 }]);
    world.frame(16);

    expect(loop).toHaveBeenCalledTimes(1);

    world.frame(16);
    world.frame(16);

    expect(loop).toHaveBeenCalledTimes(1);
    expect(world.driver.active()).toBe(1);
  });

  it("starts the loop again after a restore ended it, and only once", () => {
    const world = createMockWorld();
    const loop = vi.fn(sway);

    mountBoard(world, [], { loop });
    commitItems(world, [{ id: "a", level: 1, x: 0, y: 0 }]);
    world.frame(16);

    expect(loop).toHaveBeenCalledTimes(1);
    expect(world.driver.active()).toBe(1);

    // The flush of the restore ends every track of the view, the loop too.
    world.commit("restore", ["player"]);
    world.frame(16);

    expect(loop).toHaveBeenCalledTimes(2);
    expect(world.driver.active()).toBe(1);

    world.frame(16);
    world.frame(16);

    expect(loop).toHaveBeenCalledTimes(2);
    expect(world.driver.active()).toBe(1);
  });

  it.each([
    [
      "paused",
      (world: MockWorld): void => world.api.ecs.setMode("paused"),
      (world: MockWorld): void => world.api.ecs.setMode("live")
    ],
    [
      "fast",
      (world: MockWorld): void => {
        world.flow.mode = "fast";
      },
      (world: MockWorld): void => {
        world.flow.mode = "live";
      }
    ]
  ] as const)("starts no loop while the world is %s, and the owed one on the first sweep once it is live again", (_mode, enter, leave) => {
    const world = createMockWorld();
    const loop = vi.fn(sway);

    mountBoard(world, [{ id: "a", level: 1, x: 0, y: 0 }], { loop });
    enter(world);
    world.frame(16);
    world.frame(16);

    expect(loop).not.toHaveBeenCalled();
    expect(world.driver.active()).toBe(0);

    // Back to live: no commit and no reconcile, only the sweep of the next frame.
    leave(world);
    world.frame(16);

    expect(loop).toHaveBeenCalledTimes(1);
    expect(world.driver.active()).toBe(1);
  });

  it("starts a loop a paused reconcile ended again when the world is live", () => {
    const world = createMockWorld();
    const loop = vi.fn(sway);

    mountBoard(world, [], { loop });
    commitItems(world, [{ id: "a", level: 1, x: 0, y: 0 }]);
    world.frame(16);

    world.api.ecs.setMode("paused");
    world.commit("edge", ["player"]);
    world.frame(16);

    expect(world.driver.active()).toBe(0);
    expect(loop).toHaveBeenCalledTimes(1);

    world.api.ecs.setMode("live");
    world.frame(16);

    expect(loop).toHaveBeenCalledTimes(2);
    expect(world.driver.active()).toBe(1);
  });

  it("starts no loop without a tween driver, and the owed one once a driver is installed", () => {
    const world = createMockWorld();
    const loop = vi.fn(sway);

    world.offDriver();
    mountBoard(world, [{ id: "a", level: 1, x: 0, y: 0 }], { loop });
    world.frame(16);
    world.frame(16);

    // The instant driver would write the end pose of the loop once: none is started.
    expect(loop).not.toHaveBeenCalled();

    world.api.projection.setDriver(world.driver);
    world.frame(16);

    expect(loop).toHaveBeenCalledTimes(1);
    expect(world.driver.active()).toBe(1);
  });

  it("starts the loop a replaced spec brings", () => {
    const world = createMockWorld();
    const loop = vi.fn(sway);

    mountBoard(world, [{ id: "a", level: 1, x: 0, y: 0 }]);
    world.frame(16);

    expect(world.driver.started).toHaveLength(0);

    world.api.projection.replace(boardItems({ loop }));
    world.frame(16);

    expect(loop).toHaveBeenCalledTimes(1);
    expect(world.driver.active()).toBe(1);
  });

  it("logs a loop hook that throws and does not try again", () => {
    const world = createMockWorld();
    const loop = vi.fn((): Motion => {
      throw new Error("boom");
    });

    mountBoard(world, [{ id: "a", level: 1, x: 0, y: 0 }], { loop });
    world.frame(16);
    world.frame(16);

    expect(loop).toHaveBeenCalledTimes(1);
    expect(world.log.error).toHaveBeenCalledWith(
      "world:motion-hook-failed",
      expect.objectContaining({ projection: BOARD, key: "a", hook: "loop" }),
      expect.any(Error)
    );
  });
});

// ---------------------------------------------------------------------------
// F4. An owner that despawns its element leaves what the projection kept about it: the
// rest pose, and the key it registered. The sweep and the converge step drop both.
// ---------------------------------------------------------------------------

describe("projection reconcile — F4: the rest table holds no dead entity", () => {
  it("drops the rest pose of an entity its owner despawned, on the next sweep", () => {
    const world = createMockWorld();
    const entity = spawnElement(world);
    const other = world.api.ecs.spawn(ELEMENT_OWNER, [Transform({ x: 1, y: 2, scale: 1 })]);

    world.api.projection.setRest(other, Transform, { x: 1, y: 2, scale: 1 });
    world.api.ecs.despawn(entity);

    // The hole: nothing told the projection that the element left.
    expect(world.ctx.state.projection.rests.has(entity)).toBe(true);

    world.frame(16);

    expect(world.ctx.state.projection.rests.has(entity)).toBe(false);
    expect(world.api.projection.restOf(entity, Transform)).toBeUndefined();
    // A live element keeps its pose.
    expect(world.api.projection.restOf(other, Transform)).toEqual({ x: 1, y: 2, scale: 1 });
  });

  it("drops the pose a view handle recorded for an element that is gone", () => {
    const world = createMockWorld();

    mountBoard(world, []);

    const entity = world.api.ecs.spawn(ELEMENT_OWNER, [Transform({ x: 1, y: 2, scale: 1 })]);

    expect(world.api.projection.viewOf(entity, ELEMENT_OWNER)).toBeDefined();

    world.api.ecs.despawn(entity);
    world.frame(16);

    expect(world.ctx.state.projection.rests.has(entity)).toBe(false);
  });

  it("drops it in the converge step too, where no sweep runs", () => {
    const world = createMockWorld();
    const entity = spawnElement(world);

    world.api.projection.registerKey("hud", "coins", entity);
    world.api.ecs.despawn(entity);
    world.api.ecs.setMode("paused");
    world.commit("restore", ["player"]);
    world.frame(16);

    expect(world.ctx.state.projection.rests.has(entity)).toBe(false);
    expect(world.api.projection.keyOf(entity)).toBeUndefined();
    expect(world.log.error).not.toHaveBeenCalled();
  });

  it("drops the key of an element its owner despawned without calling the remover", () => {
    const world = createMockWorld();
    const entity = spawnElement(world);
    const drop = world.api.projection.registerKey("hud", "coins", entity);

    world.api.ecs.despawn(entity);

    // The same hole: the key still answers with an entity that is gone.
    expect(world.api.projection.entityOf("hud", "coins")).toBe(entity);

    world.frame(16);

    expect(world.api.projection.keyOf(entity)).toBeUndefined();
    expect(world.api.projection.entityOf("hud", "coins")).toBeUndefined();
    expect(world.ctx.state.projection.keysByEntity.has(entity)).toBe(false);
    // The remover that comes late finds nothing and is still safe.
    expect(() => drop()).not.toThrow();
  });

  it("keeps the key a new element took over from the one that is gone", () => {
    const world = createMockWorld();
    const first = spawnElement(world);

    world.api.projection.registerKey("hud", "coins", first);
    world.api.ecs.despawn(first);

    const second = world.api.ecs.spawn(ELEMENT_OWNER, [Transform({ x: 1, y: 2, scale: 1 })]);

    world.api.projection.registerKey("hud", "coins", second);
    world.frame(16);

    expect(world.api.projection.keyOf(first)).toBeUndefined();
    expect(world.api.projection.entityOf("hud", "coins")).toBe(second);
    expect(world.api.projection.keyOf(second)).toEqual({ projection: "hud", key: "coins" });
  });
});

// ---------------------------------------------------------------------------
// A2. A `from` that maps or spreads hands out a new object with the same content on
// every commit. In play mode its view is treated like the same object: nothing is touched.
// ---------------------------------------------------------------------------

describe("projection reconcile — A2: an item with the same content keeps the running motion of its view", () => {
  it("keeps a running tween when a commit hands out a new object with equal components", () => {
    const world = createMockWorld({ reconciledEvent: true });
    const handles: MotionHandle[] = [];
    const settle = vi.fn((view: ViewHandle<Item>, components: readonly string[]) =>
      view.all(components.map(name => restOfName(view, name)))
    );
    const change = vi.fn((view: ViewHandle<Item>) => {
      const handle = view.toRest(Transform, { ms: 400, ease: "linear" });

      handles.push(handle);

      return handle;
    });

    mountBoard(world, [{ id: "a", level: 1, x: 0, y: 0 }], {
      change: { Transform: change },
      settle
    });

    const entity = world.api.projection.entityOf(BOARD, "a") ?? 0;

    commitItems(world, [{ id: "a", level: 1, x: 100, y: 0 }]);
    world.frame(16);
    world.frame(100);

    const midway = world.api.ecs.get(entity, Transform)?.x ?? -1;

    world.emitted.length = 0;

    // The same content in a new object.
    commitItems(world, [{ id: "a", level: 1, x: 100, y: 0 }]);
    world.frame(100);

    expect(handles[0]?.active()).toBe(true);
    expect(change).toHaveBeenCalledTimes(1);
    expect(settle).not.toHaveBeenCalled();
    expect(world.driver.started).toHaveLength(1);
    expect(world.emitted[0]?.payload).toMatchObject({ mode: "play", changed: 0 });
    // The flight went on from where it was: a quarter of the way in 100 of 400 ms.
    expect(world.api.ecs.get(entity, Transform)?.x).toBeCloseTo(midway + 25, 6);

    settleFrames(world);

    expect(world.api.ecs.get(entity, Transform)).toEqual({ x: 100, y: 0, scale: 1 });
    expectConverged(world, "a");
  });

  it("stores the new item: the same object is skipped by identity the next time", () => {
    const world = createMockWorld();
    const view = vi.fn((item: Item) => [Transform({ x: item.x, y: item.y, scale: 1 })]);

    world.model.player = { items: [{ id: "a", level: 1, x: 10, y: 20 }] };
    world.api.projection.setLayers(LAYERS);
    world.api.projection.register({
      name: BOARD,
      layer: "items",
      from: (player: { items: Item[] }) => player.items,
      key: (found: Item) => found.id,
      view
    });
    world.start();
    world.api.projection.mount([BOARD], MOUNT_OWNER);

    const equal: Item = { id: "a", level: 1, x: 10, y: 20 };

    commitItems(world, [equal]);
    world.frame(16);

    // `view` runs once for the new object: its output is what the diff compares.
    expect(view).toHaveBeenCalledTimes(2);
    expect(viewOf(world, "a")?.item).toBe(equal);

    world.commit();
    world.frame(16);

    expect(view).toHaveBeenCalledTimes(2);
  });

  it("leaves a hint for that key unused", () => {
    const world = createMockWorld({ reconciledEvent: true });

    mountBoard(world, [{ id: "a", level: 1, x: 0, y: 0 }], {
      change: { Transform: view => view.toRest(Transform, { ms: 400 }) }
    });
    world.emitted.length = 0;

    world.release({ kind: "moved", payload: { key: "a" }, hint: true });
    commitItems(world, [{ id: "a", level: 1, x: 0, y: 0 }]);
    world.frame(16);

    expect(world.emitted[0]?.payload).toMatchObject({
      changed: 0,
      hintsRouted: 0,
      hintsDropped: 1
    });
  });

  it("plays the change as before when one component differs", () => {
    const world = createMockWorld({ reconciledEvent: true });
    const handles: MotionHandle[] = [];

    mountBoard(world, [{ id: "a", level: 1, x: 0, y: 0 }], {
      change: {
        Transform: view => {
          const handle = view.toRest(Transform, { ms: 400, ease: "linear" });

          handles.push(handle);

          return handle;
        }
      }
    });

    commitItems(world, [{ id: "a", level: 1, x: 100, y: 0 }]);
    world.frame(16);
    world.frame(100);
    world.emitted.length = 0;

    world.release({ kind: "moved", payload: { key: "a" }, hint: true });
    commitItems(world, [{ id: "a", level: 1, x: 200, y: 0 }]);
    world.frame(16);

    // The retarget of spike P5: the running motion is cancelled and a new one starts.
    expect(handles).toHaveLength(2);
    expect(handles[0]?.active()).toBe(false);
    expect(handles[1]?.active()).toBe(true);
    expect(world.emitted[0]?.payload).toMatchObject({
      changed: 1,
      hintsRouted: 1,
      hintsDropped: 0
    });
  });

  it("leaves an off-rest view with a new equal object where it is on an edge", () => {
    const world = createMockWorld();
    const settle = vi.fn((view: ViewHandle<Item>, components: readonly string[]) =>
      view.all(components.map(name => restOfName(view, name)))
    );

    mountBoard(world, [{ id: "a", level: 1, x: 10, y: 20 }], { settle });

    const entity = world.api.projection.entityOf(BOARD, "a") ?? 0;

    timelineTrack(world, entity, { y: -900 }).finish();

    const started = world.driver.started.length;

    commitItems(world, [{ id: "a", level: 1, x: 10, y: 20 }]);
    world.frame(16);
    world.frame(100);

    // Treated like the same object: such a commit no longer settles the loose components.
    expect(settle).not.toHaveBeenCalled();
    expect(world.driver.started).toHaveLength(started);
    expect(world.api.ecs.get(entity, Transform)).toEqual({ x: 10, y: -900, scale: 1 });
  });

  it("settles an off-rest view with a new equal object on a rollback, and counts no change", () => {
    const world = createMockWorld({ reconciledEvent: true });
    const settle = vi.fn((view: ViewHandle<Item>, components: readonly string[]) =>
      view.all(components.map(name => restOfName(view, name)))
    );

    mountBoard(world, [{ id: "a", level: 1, x: 10, y: 20 }], { settle });

    const entity = world.api.projection.entityOf(BOARD, "a") ?? 0;
    const equal: Item = { id: "a", level: 1, x: 10, y: 20 };

    timelineTrack(world, entity, { y: -900 }).finish();
    world.emitted.length = 0;

    world.model.player = { items: [equal] };
    world.commit("rollback", ["player"]);
    world.frame(16);

    expect(settle).toHaveBeenCalledTimes(1);
    expect(settle.mock.calls[0]?.[1]).toEqual(["Transform"]);
    expect(world.emitted[0]?.payload).toMatchObject({ mode: "play", changed: 0 });
    expect(viewOf(world, "a")?.item).toBe(equal);

    settleFrames(world);

    expect(world.api.ecs.get(entity, Transform)).toEqual({ x: 10, y: 20, scale: 1 });
    expectConverged(world, "a");
  });

  it("converges a new equal object as before in direct mode", () => {
    const world = createMockWorld({ reconciledEvent: true });

    mountBoard(world, [{ id: "a", level: 1, x: 10, y: 20 }]);

    const entity = world.api.projection.entityOf(BOARD, "a") ?? 0;

    world.api.ecs.set(entity, Transform, { y: -900 });
    world.api.ecs.setMode("paused");
    world.emitted.length = 0;

    commitItems(world, [{ id: "a", level: 1, x: 10, y: 20 }]);
    world.frame(16);

    expect(world.api.ecs.get(entity, Transform)).toEqual({ x: 10, y: 20, scale: 1 });
    expect(world.emitted[0]?.payload).toMatchObject({ mode: "direct", changed: 1 });
  });
});

// ---------------------------------------------------------------------------
// F2, the two other places that cancel the motions of a view in play mode:
// `settle(entity)` and a revive. With nothing loose no motion starts, so the drop is applied there.
// ---------------------------------------------------------------------------

describe("projection reconcile — F2: a pending lift(false) survives settle(entity) and a revive", () => {
  it("drops the view when settle(entity) cancels its last motion and nothing is loose", () => {
    const world = createMockWorld();

    mountPulsing(world, [{ id: "a", level: 1, x: 0, y: 0 }]);

    const entity = world.api.projection.entityOf(BOARD, "a") ?? 0;

    world.api.projection.lift(entity, true);
    commitItems(world, [{ id: "a", level: 1, x: 90, y: 0 }]);
    world.frame(16);
    world.api.projection.lift(entity, false);

    expect(storedOf(world, entity, "Layer")).toEqual({ name: "lifted" });

    // The pulse is cancelled and the view stands on its rest pose: no settle motion starts.
    world.api.projection.settle(entity);

    expect(world.driver.active()).toBe(0);
    expect(storedOf(world, entity, "Layer")).toEqual({ name: "items" });
    expect(viewOf(world, "a")).toMatchObject({ lifted: false, dropWhenStill: false });
  });

  it("keeps the drop waiting while the settle of settle(entity) still moves the view", () => {
    const world = createMockWorld();
    const entity = liftAndRelease(world);

    world.api.projection.settle(entity);

    expect(world.driver.active()).toBe(1);
    expect(storedOf(world, entity, "Layer")).toEqual({ name: "lifted" });

    settleFrames(world);

    expect(storedOf(world, entity, "Layer")).toEqual({ name: "items" });
  });

  it("keeps a view the finger still holds lifted when settle(entity) finds nothing loose", () => {
    const world = createMockWorld();

    mountPulsing(world, [{ id: "a", level: 1, x: 0, y: 0 }]);

    const entity = world.api.projection.entityOf(BOARD, "a") ?? 0;

    world.api.projection.lift(entity, true);
    commitItems(world, [{ id: "a", level: 1, x: 90, y: 0 }]);
    world.frame(16);
    world.api.projection.settle(entity);

    expect(storedOf(world, entity, "Layer")).toEqual({ name: "lifted" });
  });

  it("drops the view when it is revived with nothing loose", () => {
    const world = createMockWorld();

    mountBoard(world, [{ id: "a", level: 1, x: 0, y: 0 }], {
      change: {
        Transform: (view, _previous, next) => {
          view.set(Transform, { x: next.x });

          return view.tween(Transform, { scale: 1 }, { ms: 400, ease: "linear" });
        }
      },
      // An exit that moves nothing: the view stands on its rest pose while it leaves.
      exit: view => view.tween(Transform, { scale: 1 }, { ms: 400, ease: "linear" })
    });

    const entity = world.api.projection.entityOf(BOARD, "a") ?? 0;

    world.api.projection.lift(entity, true);
    commitItems(world, [{ id: "a", level: 1, x: 90, y: 0 }]);
    world.frame(16);
    world.api.projection.lift(entity, false);

    commitItems(world, []);
    world.frame(16);

    expect(world.api.ecs.has(entity, Exiting)).toBe(true);

    // The key comes back while the exit still plays: the same view, with nothing to bring home.
    commitItems(world, [{ id: "a", level: 1, x: 90, y: 0 }]);
    world.frame(16);

    expect(world.api.projection.entityOf(BOARD, "a")).toBe(entity);
    expect(world.driver.active()).toBe(0);
    expect(storedOf(world, entity, "Layer")).toEqual({ name: "items" });
    expect(viewOf(world, "a")).toMatchObject({ lifted: false, dropWhenStill: false });
  });
});

// ---------------------------------------------------------------------------
// F1b. The loop of a view is an additive track: it adds an offset to the rest pose and
// owns no component. The driver reports what it adds right now, and the world compares
// the value under it with the rest pose. A looping view at home is home; a moved one is not.
// ---------------------------------------------------------------------------

/**
 * Makes the driver of the mock world report what a loop adds to `Transform` right now, as
 * `anim` reports the offsets of its additive tracks. The fake driver runs no loop, so a test
 * writes the stored value itself: the value under the loop plus the offset.
 *
 * @param world - The mock world.
 * @param offsets - Field name to what the loop adds to it.
 */
function reportOffsets(world: MockWorld, offsets: Readonly<Record<string, number>>): void {
  world.offDriver();
  world.api.projection.setDriver({
    track: world.driver.track,
    cancelAll: world.driver.cancelAll,
    offsetsOf: (_entity, component) => (component.componentName === "Transform" ? offsets : {})
  });
}

/**
 * Builds the settle hook of a test: it brings every named component home and counts its calls.
 *
 * @returns The hook, as a spy.
 */
function settleSpy() {
  return vi.fn((view: ViewHandle<Item>, components: readonly string[]) =>
    view.all(components.map(name => restOfName(view, name)))
  );
}

/**
 * Runs the reconcile slot of one frame and nothing after it, so the driver does not step.
 *
 * @param world - The mock world.
 */
function reconcileOnly(world: MockWorld): void {
  for (const registration of world.frames) {
    if (registration.phase === "input") registration.callback({ ...world.time });
  }
}

/**
 * Mounts one item whose view stands at home under a loop that adds 5 to `y` right now. The loop
 * is started through the `loop` hook, so the world records an additive track on `Transform.y`
 * as it does for a real loop. Its delay is an hour: the fake driver knows no offsets and would
 * write `y` itself, so the track never comes to write within a test.
 *
 * @param world - The mock world.
 * @param motion - The hooks of this test, next to the loop.
 * @returns The entity of the view.
 */
function mountUnderLoop(world: MockWorld, motion: ProjectionMotion<Item>): Entity {
  mountBoard(world, [{ id: "a", level: 1, x: 10, y: 20 }], {
    ...motion,
    loop: view =>
      view.tween(
        Transform,
        { y: 20 },
        { ms: 1000, delayMs: 3_600_000, additive: true, repeat: "forever" }
      )
  });
  // The view was mounted directly: this frame starts the loop it owes.
  world.frame(16);

  const entity = world.api.projection.entityOf(BOARD, "a") ?? 0;

  reportOffsets(world, { y: 5 });
  world.api.ecs.set(entity, Transform, { y: 25 });

  return entity;
}

describe("projection reconcile — F1b: the world compares the value under the loop", () => {
  it("guard against a settle of no length: a rollback takes a view that stands at home under its loop for home", () => {
    const world = createMockWorld();
    const settle = settleSpy();
    const entity = mountUnderLoop(world, { settle });

    world.commit("rollback", ["player"]);
    world.frame(16);

    expect(settle).not.toHaveBeenCalled();
    // The loop is the one track that ever started.
    expect(world.driver.started).toHaveLength(1);
    expect(world.api.ecs.get(entity, Transform)).toEqual({ x: 10, y: 25, scale: 1 });
  });

  it("guard against a settle of no length: settle(entity) starts no settle for it", () => {
    const world = createMockWorld();
    const settle = settleSpy();
    const entity = mountUnderLoop(world, { settle });

    world.api.projection.settle(entity);

    expect(settle).not.toHaveBeenCalled();
    expect(world.driver.started).toHaveLength(1);
  });

  it("guard against a settle of no length: a commit that changes another component starts no settle for it", () => {
    const world = createMockWorld();
    const settle = settleSpy();
    const entity = mountUnderLoop(world, { settle });

    // `Level` has no hook: it is written directly, and `Transform` is home under its loop.
    commitItems(world, [{ id: "a", level: 2, x: 10, y: 20 }]);
    world.frame(16);

    expect(world.api.ecs.get(entity, Level)).toEqual({ level: 2 });
    expect(settle).not.toHaveBeenCalled();
    expect(world.driver.started).toHaveLength(1);
  });

  it("guard against a settle of no length: a revive starts no settle for it", () => {
    const world = createMockWorld();
    const settle = settleSpy();
    const entity = mountUnderLoop(world, {
      settle,
      // An exit that moves nothing: the view stands on its rest pose while it leaves.
      exit: view => view.tween(Transform, { scale: 1 }, { ms: 400, ease: "linear" })
    });

    commitItems(world, []);
    world.frame(16);

    expect(viewOf(world, "a")?.exiting).toBe(true);

    commitItems(world, [{ id: "a", level: 1, x: 10, y: 20 }]);
    world.frame(16);

    expect(world.api.projection.entityOf(BOARD, "a")).toBe(entity);
    expect(settle).not.toHaveBeenCalled();
    // The exit was cancelled and no settle started: only the loop runs.
    expect(world.driver.active()).toBe(1);
  });

  it("settles a view a node moved under its loop, in the very field the loop adds to", () => {
    const world = createMockWorld();
    const settle = settleSpy();
    const entity = mountUnderLoop(world, { settle });

    // The node flew the view up: the value under the loop is -900, the loop still adds 5.
    world.api.ecs.set(entity, Transform, { y: -895 });
    world.commit("rollback", ["player"]);
    world.frame(16);

    expect(settle).toHaveBeenCalledTimes(1);
    expect(settle.mock.calls[0]?.[1]).toEqual(["Transform"]);
    expect(world.driver.started.at(-1)).toMatchObject({
      entity,
      component: "Transform",
      to: { x: 10, y: 20, scale: 1 },
      options: { ms: 350 }
    });
  });

  it("takes the float noise of the offset for no difference", () => {
    const world = createMockWorld();
    const settle = settleSpy();

    mountBoard(world, [{ id: "a", level: 1, x: 10, y: 0.1 }], { settle });

    const entity = world.api.projection.entityOf(BOARD, "a") ?? 0;

    // 0.1 + 0.2 - 0.2 is 0.10000000000000003: a hair off the rest value, and still home.
    reportOffsets(world, { y: 0.2 });
    world.api.ecs.set(entity, Transform, { y: 0.1 + 0.2 });
    world.commit("rollback", ["player"]);
    world.frame(16);

    expect(settle).not.toHaveBeenCalled();
    expect(world.driver.started).toHaveLength(0);
  });

  it("guard: the convergence check does not report what the loop adds when a motion of the view ends", () => {
    const world = createMockWorld();
    const entity = mountUnderLoop(world, {
      change: { Level: view => view.toRest(Level, { ms: 50, ease: "linear" }) }
    });

    commitItems(world, [{ id: "a", level: 2, x: 10, y: 20 }]);
    world.frame(16);
    world.frame(100);
    world.frame(16);

    expect(world.api.ecs.get(entity, Level)).toEqual({ level: 2 });
    expect(world.log.warn).not.toHaveBeenCalledWith("world:view-corrected", expect.anything());
    // The stored value still carries the offset: nothing wrote the rest value over it.
    expect(world.api.ecs.get(entity, Transform)).toEqual({ x: 10, y: 25, scale: 1 });
  });

  it("corrects a real miss under a loop to the rest value plus the offset, and tells the driver", () => {
    const world = createMockWorld();
    const entity = mountUnderLoop(world, {
      // A hook that stops short: under the loop it leaves `y` at 50, the new rest value is 70.
      change: { Transform: view => view.tween(Transform, { y: 55 }, { ms: 50, ease: "linear" }) }
    });

    commitItems(world, [{ id: "a", level: 1, x: 10, y: 70 }]);
    world.frame(16);
    world.frame(100);

    expect(world.log.warn).toHaveBeenCalledWith(
      "world:view-corrected",
      expect.objectContaining({ projection: BOARD, key: "a", component: "Transform" })
    );
    // The picture keeps the offset of the loop on top of the rest value.
    expect(world.api.ecs.get(entity, Transform)).toEqual({ x: 10, y: 75, scale: 1 });
    // The driver keeps its own base for the field: a track of 0 ms hands it the rest value.
    expect(world.driver.started.at(-1)).toEqual({
      entity,
      component: "Transform",
      to: { y: 70 },
      options: { ms: 0, ease: "linear", delayMs: 0, additive: false }
    });
  });

  it("guard: a driver without offsetsOf is read as no offset, the stored value is compared as it stands", () => {
    const world = createMockWorld();
    const settle = settleSpy();

    mountBoard(world, [{ id: "a", level: 1, x: 10, y: 20 }], { settle });

    const entity = world.api.projection.entityOf(BOARD, "a") ?? 0;

    // The fake driver has no `offsetsOf`: nothing is taken off the stored value.
    world.commit("rollback", ["player"]);
    world.frame(16);

    expect(settle).not.toHaveBeenCalled();

    world.api.ecs.set(entity, Transform, { y: 25 });
    world.commit("rollback", ["player"]);
    world.frame(16);

    expect(settle).toHaveBeenCalledTimes(1);
    expect(settle.mock.calls[0]?.[1]).toEqual(["Transform"]);
  });
});

// ---------------------------------------------------------------------------
// Review fix. The driver keeps its own base for the fields a loop adds to, and writes it
// back when the loop is cancelled. A rest value the world writes directly has to reach
// that base in play mode, and has to be written last in direct mode.
// ---------------------------------------------------------------------------

/**
 * Installs a driver whose `cancelAll` writes, as a cancelled additive track of `anim` writes
 * the base it kept back.
 *
 * @param world - The mock world.
 * @param base - The stale base the cancelled loop writes.
 * @param base.y - Its `Transform.y`.
 */
function writeBaseOnCancel(world: MockWorld, base: { y: number }): void {
  world.offDriver();
  world.api.projection.setDriver({
    track: world.driver.track,
    cancelAll: (target: Entity): void => {
      world.driver.cancelAll(target);
      world.api.ecs.set(target, Transform, base);
    }
  });
}

describe("projection reconcile — a rest change under the loop of a view is kept", () => {
  it("writes a rest value under a loop with the offset on top, and hands it to the driver", () => {
    const world = createMockWorld();
    const entity = mountUnderLoop(world, {});
    const started = world.driver.started.length;

    // `Transform` has no hook: its new value is written directly.
    commitItems(world, [{ id: "a", level: 1, x: 50, y: 70 }]);
    reconcileOnly(world);

    // The picture does not lose the offset for a frame.
    expect(world.api.ecs.get(entity, Transform)).toEqual({ x: 50, y: 75, scale: 1 });
    // Only the field the loop adds to goes to the driver: a track of 0 ms to its rest value.
    expect(world.driver.started.slice(started)).toEqual([
      {
        entity,
        component: "Transform",
        to: { y: 70 },
        options: { ms: 0, ease: "linear", delayMs: 0, additive: false }
      }
    ]);
    // It was finished at once: the view keeps no handle of it, and only the loop runs.
    expect(viewOf(world, "a")?.handles).toEqual([]);
    expect(world.driver.active()).toBe(1);
  });

  it("writes a component no loop adds to directly, with no track", () => {
    const world = createMockWorld();
    const entity = mountUnderLoop(world, {});

    commitItems(world, [{ id: "a", level: 2, x: 10, y: 20 }]);
    world.frame(16);

    expect(world.api.ecs.get(entity, Level)).toEqual({ level: 2 });
    expect(world.driver.started).toHaveLength(1);
  });

  it("does the same when a settle hook throws and the rest pose is written instead", () => {
    const world = createMockWorld();
    const entity = mountUnderLoop(world, {
      settle: () => {
        throw new Error("boom");
      }
    });

    world.api.ecs.set(entity, Transform, { y: -895 });
    world.api.projection.settle(entity);

    expect(world.api.ecs.get(entity, Transform)).toEqual({ x: 10, y: 25, scale: 1 });
    expect(world.driver.started.at(-1)).toMatchObject({
      entity,
      component: "Transform",
      to: { y: 20 },
      options: { ms: 0 }
    });
  });

  it("does the same when settle(entity) writes the rest pose in a paused world", () => {
    const world = createMockWorld();
    const entity = mountUnderLoop(world, {});

    world.api.ecs.set(entity, Transform, { y: -895 });
    world.api.ecs.setMode("paused");
    world.api.projection.settle(entity);

    // The loop stands while the world is paused, and still adds its offset.
    expect(world.api.ecs.get(entity, Transform)).toEqual({ x: 10, y: 25, scale: 1 });
    expect(world.driver.started.at(-1)).toMatchObject({
      entity,
      component: "Transform",
      to: { y: 20 },
      options: { ms: 0 }
    });
    // The base went to the driver at once: nothing is left that a paused world would wait for.
    expect(viewOf(world, "a")?.handles).toEqual([]);
    expect(world.driver.active()).toBe(1);
  });

  it("writes a changed item again after the flush of a direct reconcile", () => {
    const world = createMockWorld();

    mountBoard(world, [{ id: "a", level: 1, x: 10, y: 20 }]);

    const entity = world.api.projection.entityOf(BOARD, "a") ?? 0;

    writeBaseOnCancel(world, { y: -900 });
    world.api.ecs.setMode("paused");
    commitItems(world, [{ id: "a", level: 1, x: 10, y: 70 }]);
    world.frame(16);

    expect(world.api.ecs.get(entity, Transform)).toEqual({ x: 10, y: 70, scale: 1 });
  });

  it("writes a revived item again after the flush of a direct reconcile", () => {
    const world = createMockWorld();

    mountBoard(world, [{ id: "a", level: 1, x: 10, y: 20 }], {
      exit: view => view.tween(Transform, { x: 900 }, { ms: 1000, ease: "linear" })
    });

    const entity = world.api.projection.entityOf(BOARD, "a") ?? 0;

    commitItems(world, []);
    world.frame(16);

    expect(viewOf(world, "a")?.exiting).toBe(true);

    writeBaseOnCancel(world, { y: -900 });
    world.api.ecs.setMode("paused");
    commitItems(world, [{ id: "a", level: 1, x: 10, y: 70 }]);
    world.frame(16);

    expect(world.api.projection.entityOf(BOARD, "a")).toBe(entity);
    expect(world.api.ecs.get(entity, Transform)).toEqual({ x: 10, y: 70, scale: 1 });
  });
});

// ---------------------------------------------------------------------------
// C3: every enter and exit hook learns why it plays, and `causeOf` answers how a view came or
// how it is leaving, also from a removal hook of the despawn.
// ---------------------------------------------------------------------------

/**
 * Records the cause `causeOf` answers for every entity that loses its `Level`, which a despawn
 * removes: the removal hook of a view.
 *
 * @param world - The mock world.
 * @returns The causes, in removal order.
 */
function recordRemovals(world: MockWorld): Array<MotionCause | undefined> {
  const causes: Array<MotionCause | undefined> = [];

  world.api.ecs.onRemoved(Level, entity => {
    causes.push(world.api.projection.causeOf(entity));
  });

  return causes;
}

describe("projection reconcile — C3: the motion cause", () => {
  it("hands an enter hook a commit plays the cause change", () => {
    const world = createMockWorld();
    const causes: Array<MotionCause | undefined> = [];

    mountBoard(world, [], {
      enter: (_view, _item, _hint, cause) => {
        causes.push(cause);
      }
    });
    commitItems(world, [{ id: "a", level: 1, x: 0, y: 0 }]);
    world.frame(16);

    expect(causes).toEqual(["change"]);
  });

  it("plays no enter on a mount, and causeOf answers mount for the view", () => {
    const world = createMockWorld();
    const enter = vi.fn();

    mountBoard(world, [{ id: "a", level: 1, x: 0, y: 0 }], { enter });

    const entity = world.api.projection.entityOf(BOARD, "a") ?? 0;

    expect(enter).not.toHaveBeenCalled();
    expect(world.api.projection.causeOf(entity)).toBe("mount");
  });

  it("answers change for a view a commit added", () => {
    const world = createMockWorld();

    mountBoard(world, []);
    commitItems(world, [{ id: "a", level: 1, x: 0, y: 0 }]);
    world.frame(16);

    expect(world.api.projection.causeOf(world.api.projection.entityOf(BOARD, "a") ?? 0)).toBe(
      "change"
    );
  });

  it("hands an exit hook a commit plays the cause change", () => {
    const world = createMockWorld();
    const causes: Array<MotionCause | undefined> = [];

    mountBoard(world, [{ id: "a", level: 1, x: 0, y: 0 }], {
      exit: (_view, _item, _hint, cause) => {
        causes.push(cause);
      }
    });
    commitItems(world, []);
    world.frame(16);

    expect(causes).toEqual(["change"]);
  });

  it("answers change in the removal hook of a view a commit removed after its exit", () => {
    const world = createMockWorld();
    const causes = recordRemovals(world);

    mountBoard(world, [{ id: "a", level: 1, x: 0, y: 0 }], {
      exit: view => view.tween(Transform, { scale: 0 }, { ms: 100, ease: "linear" })
    });
    commitItems(world, []);
    world.frame(16);

    expect(causes).toEqual([]);

    settleFrames(world);

    expect(causes).toEqual(["change"]);
  });

  it("answers mount in the removal hook of a Tree a scene unmount despawns, also one a commit added", () => {
    const world = createMockWorld();
    const causes: Array<MotionCause | undefined> = [];

    world.model.player = {};
    world.api.projection.setLayers(LAYERS);
    world.api.projection.register(
      projection({
        name: "hud.screen",
        layer: "items",
        from: (player: { screen?: { title: string } }) => player.screen,
        view: () => ({ type: "box", props: {}, children: [] })
      }) as AnyProjectionSpec
    );
    world.start();
    world.api.projection.mount(["hud.screen"], MOUNT_OWNER);
    world.model.player = { screen: { title: "shop" } };
    world.commit();
    world.frame(16);

    const root = world.api.projection.entityOf("hud.screen", "hud.screen") ?? 0;

    expect(world.api.projection.causeOf(root)).toBe("change");

    world.api.ecs.onRemoved(Tree, entity => {
      causes.push(world.api.projection.causeOf(entity));
    });
    world.api.projection.unmount(["hud.screen"]);

    expect(causes).toEqual(["mount"]);
  });

  it("answers mount for a view a load removed and for one a restore added", () => {
    const world = createMockWorld();
    const causes = recordRemovals(world);

    mountBoard(world, [
      { id: "a", level: 1, x: 0, y: 0 },
      { id: "b", level: 1, x: 0, y: 0 }
    ]);
    world.model.player = { items: [{ id: "a", level: 1, x: 0, y: 0 }] };
    world.commit("load");
    world.frame(16);

    expect(causes).toEqual(["mount"]);

    world.model.player = {
      items: [
        { id: "a", level: 1, x: 0, y: 0 },
        { id: "c", level: 1, x: 0, y: 0 }
      ]
    };
    world.commit("restore");
    world.frame(16);

    expect(world.api.projection.causeOf(world.api.projection.entityOf(BOARD, "c") ?? 0)).toBe(
      "mount"
    );
  });

  it("answers mount for an exiting view a load brings back", () => {
    const world = createMockWorld();

    mountBoard(world, [{ id: "a", level: 1, x: 0, y: 0 }], {
      exit: view => view.tween(Transform, { scale: 0 }, { ms: 300, ease: "linear" })
    });

    const entity = world.api.projection.entityOf(BOARD, "a") ?? 0;

    commitItems(world, []);
    world.frame(16);

    expect(world.api.projection.causeOf(entity)).toBe("change");

    world.model.player = { items: [{ id: "a", level: 1, x: 0, y: 0 }] };
    world.commit("load");
    world.frame(16);

    expect(world.api.projection.entityOf(BOARD, "a")).toBe(entity);
    expect(world.api.projection.causeOf(entity)).toBe("mount");
  });

  it("forgets the cause of a despawned view at the next sweep", () => {
    const world = createMockWorld();
    const causes = recordRemovals(world);

    mountBoard(world, [{ id: "a", level: 1, x: 0, y: 0 }]);

    const entity = world.api.projection.entityOf(BOARD, "a") ?? 0;

    commitItems(world, []);
    world.frame(16);

    expect(causes).toEqual(["change"]);
    expect(world.api.projection.causeOf(entity)).toBeUndefined();
    expect(world.ctx.state.projection.leaving.size).toBe(0);
  });

  it("answers undefined for an entity no projection made", () => {
    const world = createMockWorld();

    mountBoard(world, []);

    const element = world.api.ecs.spawn({ kind: "plugin", name: "ui" }, [Level({ level: 1 })]);

    expect(world.api.projection.causeOf(element)).toBeUndefined();
  });
});
