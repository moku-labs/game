import { describe, expect, it, vi } from "vitest";
import { createModules } from "../../api";
import { component, Exiting } from "../../ecs/define";
import { withDeps } from "../../lifecycle";
import { projection } from "../../projection/define";
import { deepEquals } from "../../projection/diff";
import { routeHint } from "../../projection/hints";
import type { AnyProjectionSpec, Motion } from "../../projection/types";
import type { Item } from "./board";
import {
  BOARD,
  commitItems,
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

// ---------------------------------------------------------------------------
// Unit test: the defensive paths of projection — internals, absent views, and the
// structural half of the component diff
// ---------------------------------------------------------------------------

const Sparkle = component("Sparkle", { power: 1 });

/* eslint-disable unicorn/no-null -- `null` is a JSON value the component diff has to separate */
describe("deepEquals", () => {
  it("separates null from an object and an object from an array", () => {
    expect(deepEquals(null, { a: 1 })).toBe(false);
    expect(deepEquals({ a: 1 }, null)).toBe(false);
    expect(deepEquals(null, null)).toBe(true);
    expect(deepEquals({ a: 1 }, [1])).toBe(false);
    expect(deepEquals([1], { a: 1 })).toBe(false);
    expect(deepEquals("a", 1)).toBe(false);
  });
});
/* eslint-enable unicorn/no-null */

describe("routeHint", () => {
  const hints = [
    { kind: "bare", hint: true as const },
    { kind: "text", payload: "a", hint: true as const },
    { kind: "merged", payload: { from: "a", into: "b", projection: BOARD }, hint: true as const }
  ];

  it("skips a hint without a payload and one whose payload is not an object", () => {
    expect(routeHint(hints, BOARD, "a")?.kind).toBe("merged");
  });

  it("answers undefined when the projection of the hint is another one", () => {
    expect(routeHint(hints, "other.items", "a")).toBeUndefined();
  });

  it("answers undefined when no field of the payload names the key", () => {
    expect(routeHint(hints, BOARD, "zz")).toBeUndefined();
  });
});

describe("projection internals", () => {
  it("ignores an unmount of a projection that is not mounted", () => {
    const world = createMockWorld();

    mountBoard(world, [{ id: "a", level: 1, x: 0, y: 0 }]);

    expect(() => world.api.projection.unmount(["never.mounted"])).not.toThrow();
    expect(world.api.projection.entityOf(BOARD, "a")).toBeDefined();
  });

  it("ignores a lift of an entity that is not a view", () => {
    const world = createMockWorld();

    mountBoard(world, [{ id: "a", level: 1, x: 0, y: 0 }]);

    expect(() => world.api.projection.lift(999, true)).not.toThrow();
  });

  it("ignores a lift on a projection that declares no lift layer", () => {
    const world = createMockWorld();

    mountBoard(world, [{ id: "a", level: 1, x: 0, y: 0 }], undefined, "none");

    const entity = world.api.projection.entityOf(BOARD, "a") ?? 0;

    world.api.projection.lift(entity, true);

    expect(storedOf(world, entity, "Layer")).toEqual({ name: "items" });
  });

  it("drops a still view back to its layer at once", () => {
    const world = createMockWorld();

    mountBoard(world, [{ id: "a", level: 1, x: 0, y: 0 }]);

    const entity = world.api.projection.entityOf(BOARD, "a") ?? 0;

    world.api.projection.lift(entity, true);
    world.api.projection.lift(entity, false);

    expect(storedOf(world, entity, "Layer")).toEqual({ name: "items" });
  });

  it("empties the hint buffer through dropHints and the whole module through clear", () => {
    const world = createMockWorld();

    mountBoard(world, [{ id: "a", level: 1, x: 0, y: 0 }]);

    const { projection: module } = createModules(withDeps(world.ctx));

    module.pushHint({ kind: "merged", payload: { from: "a" }, hint: true });
    expect(world.ctx.state.projection.hints).toHaveLength(1);

    module.dropHints();
    expect(world.ctx.state.projection.hints).toEqual([]);

    module.clear();

    expect(world.ctx.state.projection.mounted.size).toBe(0);
    expect(world.ctx.state.projection.specs.size).toBe(0);
    expect(world.api.projection.layers()).toEqual([]);
  });

  it("ignores an owner that is not a projection and a projection that is not mounted", () => {
    const world = createMockWorld();

    mountBoard(world, [{ id: "a", level: 1, x: 0, y: 0 }]);

    const { projection: module } = createModules(withDeps(world.ctx));

    module.ownerLeft({ kind: "node", name: "reward" });
    module.ownerLeft({ kind: "projection", name: "never.mounted" });

    expect(world.api.projection.entityOf(BOARD, "a")).toBeDefined();
  });

  it("reconciles only the projections a mount names", () => {
    const world = createMockWorld();
    const views = vi.fn(() => [Level({ level: 1 })]);

    world.model.player = { items: [{ id: "a", level: 1, x: 0, y: 0 }] };
    world.api.projection.setLayers(LAYERS);
    world.api.projection.register(
      projection({
        name: "board.cells",
        layer: "board",
        from: (player: { items: Item[] }) => player.items,
        key: (item: Item) => item.id,
        view: views
      }) as AnyProjectionSpec
    );
    world.api.projection.register(
      projection({
        name: BOARD,
        layer: "items",
        from: (player: { items: Item[] }) => player.items,
        key: (item: Item) => item.id,
        view: (item: Item) => [Level({ level: item.level })]
      }) as AnyProjectionSpec
    );
    world.start();
    world.api.projection.mount(["board.cells"], MOUNT_OWNER);
    expect(views).toHaveBeenCalledTimes(1);

    world.api.projection.mount([BOARD], MOUNT_OWNER);

    expect(views).toHaveBeenCalledTimes(1);
    expect(world.api.projection.entityOf(BOARD, "a")).toBeDefined();
  });

  it("logs a throwing from and leaves that projection alone", () => {
    const world = createMockWorld();

    world.model.player = { items: [] };
    world.api.projection.setLayers(LAYERS);
    world.api.projection.register({
      name: BOARD,
      layer: "items",
      from: () => {
        throw new Error("no player");
      },
      key: (item: { id: string }) => item.id,
      view: () => []
    });
    world.start();
    world.api.projection.mount([BOARD], MOUNT_OWNER);

    expect(world.log.error).toHaveBeenCalledWith(
      "world:projection-failed",
      { projection: BOARD },
      expect.any(Error)
    );
    expect(world.api.projection.entityOf(BOARD, "a")).toBeUndefined();
  });

  it("reports a hook that threw something other than an Error", () => {
    const world = createMockWorld();

    mountBoard(world, [{ id: "a", level: 1, x: 0, y: 0 }], {
      change: {
        Level: () => {
          // A game hook may throw anything.
          throw "boom";
        }
      }
    });
    commitItems(world, [{ id: "a", level: 2, x: 0, y: 0 }]);
    world.frame(16);

    expect(world.log.error).toHaveBeenCalledWith(
      "world:motion-hook-failed",
      expect.objectContaining({ hook: "change:Level" }),
      expect.any(Error)
    );
  });
});

describe("projection structural diff", () => {
  it("adds a component that the view started returning", () => {
    const world = createMockWorld();
    let sparkling = false;

    world.model.player = { items: [{ id: "a", level: 1, x: 0, y: 0 }] };
    world.api.projection.setLayers(LAYERS);
    world.api.projection.register({
      name: BOARD,
      layer: "items",
      from: (player: { items: Item[] }) => player.items,
      key: (item: Item) => item.id,
      view: (item: Item) =>
        sparkling
          ? [Level({ level: item.level }), Sparkle({ power: 3 })]
          : [Level({ level: item.level })]
    });
    world.start();
    world.api.projection.mount([BOARD], MOUNT_OWNER);

    const entity = world.api.projection.entityOf(BOARD, "a") ?? 0;

    expect(world.api.ecs.has(entity, Sparkle)).toBe(false);

    sparkling = true;
    commitItems(world, [{ id: "a", level: 2, x: 0, y: 0 }]);
    world.frame(16);

    expect(world.api.ecs.get(entity, Sparkle)).toEqual({ power: 3 });
  });

  it("revive: the same view takes an added component and loses a removed one", () => {
    const world = createMockWorld();
    let sparkling = false;

    world.model.player = { items: [{ id: "a", level: 1, x: 0, y: 0 }] };
    world.api.projection.setLayers(LAYERS);
    world.api.projection.register({
      name: BOARD,
      layer: "items",
      lift: "lifted",
      from: (player: { items: Item[] }) => player.items,
      key: (item: Item) => item.id,
      view: (item: Item) =>
        sparkling
          ? [Level({ level: item.level }), Sparkle({ power: 3 })]
          : [Level({ level: item.level }), Transform({ x: item.x, y: 0, scale: 1 })],
      motion: { exit: view => view.tween(Level, { level: 9 }, { ms: 1000, ease: "linear" }) }
    });
    world.start();
    world.api.projection.mount([BOARD], MOUNT_OWNER);

    const entity = world.api.projection.entityOf(BOARD, "a") ?? 0;

    world.api.projection.lift(entity, true);
    commitItems(world, []);
    world.frame(16);
    expect(world.api.ecs.has(entity, Exiting)).toBe(true);

    sparkling = true;
    commitItems(world, [{ id: "a", level: 2, x: 0, y: 0 }]);
    world.frame(16);

    expect(world.api.projection.entityOf(BOARD, "a")).toBe(entity);
    expect(world.api.ecs.get(entity, Sparkle)).toEqual({ power: 3 });
    expect(world.api.ecs.has(entity, Transform)).toBe(false);
    expect(storedOf(world, entity, "Layer")).toEqual({ name: "lifted" });

    settleFrames(world);
  });

  it("revive on a load writes the rest pose at once", () => {
    const world = createMockWorld();

    mountBoard(world, [{ id: "a", level: 1, x: 0, y: 0 }], {
      exit: view => view.tween(Transform, { x: 900 }, { ms: 1000, ease: "linear" })
    });

    const entity = world.api.projection.entityOf(BOARD, "a") ?? 0;

    commitItems(world, []);
    world.frame(16);
    expect(viewOf(world, "a")?.exiting).toBe(true);

    world.model.player = { items: [{ id: "a", level: 5, x: 30, y: 0 }] };
    world.commit("load", ["player"]);
    world.frame(16);

    expect(world.api.projection.entityOf(BOARD, "a")).toBe(entity);
    expect(world.api.ecs.get(entity, Transform)).toEqual({ x: 30, y: 0, scale: 1 });
    expect(world.api.ecs.get(entity, Level)).toEqual({ level: 5 });
    expect(world.ctx.state.projection.tracks).toEqual([]);
  });

  it("keeps an enter motion and despawns an exit without a lift layer", () => {
    const world = createMockWorld();
    const entered: Motion[] = [];

    mountBoard(
      world,
      [],
      {
        enter: view => {
          const handle = view.tween(Transform, { scale: 1 }, { ms: 100, ease: "linear" });

          entered.push(handle);

          return handle;
        },
        exit: view => view.tween(Transform, { x: 900 }, { ms: 100, ease: "linear" })
      },
      "none"
    );

    commitItems(world, [{ id: "a", level: 1, x: 0, y: 0 }]);
    world.frame(16);

    expect(entered).toHaveLength(1);

    const entity = world.api.projection.entityOf(BOARD, "a") ?? 0;

    commitItems(world, []);
    world.frame(16);

    expect(world.api.ecs.has(entity, Exiting)).toBe(true);
    expect(storedOf(world, entity, "Layer")).toEqual({ name: "items" });

    settleFrames(world);
    expect(world.api.ecs.has(entity, Transform)).toBe(false);
  });

  it("writes a rest component the entity lost, and skips a tag, when a paused view settles", () => {
    const world = createMockWorld();

    mountBoard(world, [{ id: "a", level: 1, x: 0, y: 0 }]);

    const entity = world.api.projection.entityOf(BOARD, "a") ?? 0;

    world.api.ecs.remove(entity, Transform);
    expect(world.api.ecs.has(entity, Transform)).toBe(false);

    world.api.ecs.setMode("paused");
    world.api.projection.settle(entity);

    expect(world.api.ecs.get(entity, Transform)).toEqual({ x: 0, y: 0, scale: 1 });
  });
});
