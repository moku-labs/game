import { describe, expect, it, vi } from "vitest";
import { Exiting } from "../../ecs/define";
import type { Entity } from "../../ecs/types";
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
import { createMockWorld } from "./mock-world";

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
    expect(world.ctx.state.projection.tracks.some(track => !track.ended)).toBe(false);
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
