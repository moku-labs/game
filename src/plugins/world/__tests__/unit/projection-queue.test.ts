import { describe, expect, it, vi } from "vitest";
import { Exiting } from "../../ecs/define";
import type { ProjectionMotion, ViewHandle } from "../../projection/types";
import type { Item } from "./board";
import {
  BOARD,
  commitItems,
  expectConverged,
  MOUNT_OWNER,
  mountBoard,
  restOfName,
  settleFrames,
  storedOf,
  Transform,
  viewOf
} from "./board";
import { createMockWorld } from "./mock-world";

const flyAway: ProjectionMotion<Item> = {
  exit: view => view.tween(Transform, { x: 900 }, { ms: 1000, ease: "linear" })
};

describe("projection despawn queue — the spike cases", () => {
  it("not hit-tested while queued: the view stays drawn, carries Exiting and leaves entityOf", () => {
    const world = createMockWorld();

    mountBoard(world, [{ id: "a", level: 1, x: 0, y: 0 }], flyAway);

    const entity = world.api.projection.entityOf(BOARD, "a") ?? 0;

    commitItems(world, []);
    world.frame(16);

    expect(world.api.projection.entityOf(BOARD, "a")).toBeUndefined();
    expect(world.api.projection.keyOf(entity)).toEqual({ projection: BOARD, key: "a" });
    expect(world.api.ecs.has(entity, Exiting)).toBe(true);
    expect(storedOf(world, entity, "Layer")).toEqual({ name: "lifted" });
  });

  it("the sweep despawns a queued view when its last motion ended", () => {
    const world = createMockWorld();

    mountBoard(world, [{ id: "a", level: 1, x: 0, y: 0 }], {
      exit: view => view.tween(Transform, { x: 900 }, { ms: 100, ease: "linear" })
    });

    const entity = world.api.projection.entityOf(BOARD, "a") ?? 0;

    commitItems(world, []);
    world.frame(16);
    expect(world.api.ecs.has(entity, Transform)).toBe(true);

    settleFrames(world);

    expect(world.api.ecs.has(entity, Transform)).toBe(false);
    expect(world.api.projection.keyOf(entity)).toBeUndefined();
  });

  it("revive: the same view comes back, without enter and without change", () => {
    const world = createMockWorld();
    const enter = vi.fn();
    const change = vi.fn();
    const settle = vi.fn((view: ViewHandle<Item>, components: readonly string[]) =>
      view.all(components.map(name => restOfName(view, name)))
    );

    mountBoard(world, [{ id: "a", level: 1, x: 0, y: 0 }], {
      enter,
      change: { Transform: change },
      settle,
      exit: view => view.tween(Transform, { x: 900 }, { ms: 1000, ease: "linear" })
    });

    const entity = world.api.projection.entityOf(BOARD, "a") ?? 0;

    commitItems(world, []);
    world.frame(16);
    expect(world.api.ecs.has(entity, Exiting)).toBe(true);

    commitItems(world, [{ id: "a", level: 2, x: 40, y: 0 }]);
    world.frame(16);

    expect(world.api.projection.entityOf(BOARD, "a")).toBe(entity);
    expect(world.api.ecs.has(entity, Exiting)).toBe(false);
    expect(storedOf(world, entity, "Layer")).toEqual({ name: "items" });
    expect(enter).not.toHaveBeenCalled();
    expect(change).not.toHaveBeenCalled();
    expect(settle).toHaveBeenCalledTimes(1);
    expect(world.ctx.state.projection.byEntity.size).toBe(1);

    settleFrames(world);
    expectConverged(world, "a");
  });

  it("two commits in one frame: a hint for a key that never had a view is dropped", () => {
    const world = createMockWorld({ reconciledEvent: true });

    mountBoard(world, [{ id: "a", level: 1, x: 0, y: 0 }], flyAway);
    world.emitted.length = 0;

    world.release({ kind: "spawned", payload: { key: "never" }, hint: true });
    commitItems(world, [
      { id: "a", level: 1, x: 0, y: 0 },
      { id: "b", level: 1, x: 10, y: 0 }
    ]);
    commitItems(world, [{ id: "b", level: 1, x: 10, y: 0 }]);
    world.frame(16);

    expect(world.emitted).toHaveLength(1);
    expect(world.emitted[0]?.payload).toMatchObject({ entered: 1, exited: 1, hintsDropped: 1 });

    settleFrames(world);
    expectConverged(world, "b");
  });

  it("unmount flush: motions are finished and the queue is emptied in the same call", () => {
    const world = createMockWorld();

    mountBoard(
      world,
      [
        { id: "a", level: 1, x: 0, y: 0 },
        { id: "b", level: 1, x: 10, y: 0 }
      ],
      flyAway
    );

    const gone = world.api.projection.entityOf(BOARD, "a") ?? 0;
    const staying = world.api.projection.entityOf(BOARD, "b") ?? 0;

    commitItems(world, [{ id: "b", level: 1, x: 10, y: 0 }]);
    world.frame(16);

    expect(world.api.ecs.has(gone, Exiting)).toBe(true);

    world.api.projection.unmount([BOARD]);

    expect(world.api.ecs.has(gone, Transform)).toBe(false);
    expect(world.api.ecs.has(staying, Transform)).toBe(false);
    expect(world.ctx.state.projection.byEntity.size).toBe(0);
    expect(world.ctx.state.projection.tracks).toEqual([]);
  });

  it("flushes the queue when the mount owner leaves", () => {
    const world = createMockWorld();

    mountBoard(world, [{ id: "a", level: 1, x: 0, y: 0 }], flyAway);
    commitItems(world, []);
    world.frame(16);

    world.api.ecs.despawnOwnedBy({ kind: "projection", name: BOARD });

    expect(world.ctx.state.projection.byEntity.size).toBe(0);
    expect(world.api.projection.entityOf(BOARD, "a")).toBeUndefined();
  });

  it("despawns two queued views in one sweep", () => {
    const world = createMockWorld();

    mountBoard(
      world,
      [
        { id: "a", level: 1, x: 0, y: 0 },
        { id: "b", level: 1, x: 10, y: 0 }
      ],
      { exit: view => view.tween(Transform, { x: 900 }, { ms: 50, ease: "linear" }) }
    );

    commitItems(world, []);
    world.frame(16);

    expect(world.ctx.state.projection.byEntity.size).toBe(2);

    settleFrames(world);

    expect(world.ctx.state.projection.byEntity.size).toBe(0);
  });

  it("flushes the queue when the mode turns fast", () => {
    const world = createMockWorld();

    mountBoard(world, [{ id: "a", level: 1, x: 0, y: 0 }], flyAway);
    commitItems(world, []);
    world.frame(16);

    expect(viewOf(world, "a")).toBeDefined();

    world.api.ecs.setMode("fast");

    expect(viewOf(world, "a")).toBeUndefined();
    expect(world.ctx.state.projection.tracks).toEqual([]);
  });

  it("despawns an exited view at once when the exit hook returns nothing", () => {
    const world = createMockWorld();

    mountBoard(world, [{ id: "a", level: 1, x: 0, y: 0 }], {
      exit: () => {}
    });

    const entity = world.api.projection.entityOf(BOARD, "a") ?? 0;

    commitItems(world, []);
    world.frame(16);

    expect(world.api.ecs.has(entity, Transform)).toBe(false);
  });

  it("clears the world on stop and leaves the mounted projections empty", () => {
    const world = createMockWorld();

    mountBoard(world, [{ id: "a", level: 1, x: 0, y: 0 }], flyAway);
    commitItems(world, []);
    world.frame(16);

    world.api.projection.unmount([BOARD]);
    world.api.projection.mount([BOARD], MOUNT_OWNER);

    expect(world.api.projection.entityOf(BOARD, "a")).toBeUndefined();
  });
});
