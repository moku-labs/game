import { describe, expect, it, vi } from "vitest";
import { component, Exiting } from "../../ecs/define";
import type { AnyComponent, Entity, Owner } from "../../ecs/types";
import type { MotionHandle } from "../../projection/types";
import type { Item } from "./board";
import {
  BOARD,
  commitItems,
  expectConverged,
  LAYERS,
  Level,
  MOUNT_OWNER,
  mountBoard,
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
