import { describe, expect, it, vi } from "vitest";
import { Order } from "../../ecs/define";
import type { Entity } from "../../ecs/types";
import { projection } from "../../projection/define";
import type {
  AnyProjectionSpec,
  DescriptionNode,
  LayerSpec,
  ProjectionMotion,
  ViewHandle
} from "../../projection/types";
import { BOARD, boardItems, type Item, LAYERS, MOUNT_OWNER, Transform } from "./board";
import { createMockWorld, type MockWorld } from "./mock-world";

// ---------------------------------------------------------------------------
// Unit test (spec 31, F61 S2): the next scene built aside. `build` mounts the
// projections only the coming list names into a table of their own, flagged
// building, while the ward stays mounted; `commit` moves them in at the swap,
// `discard` drops them on an abort. `left`, `built`, `isBuilding`, `onBuild` and
// `adopt` are what ui, renderer and scenes read meanwhile.
// ---------------------------------------------------------------------------

/** The layers of the ward: one `ui` layer sorted by order. */
const WARD_LAYERS: readonly LayerSpec[] = [{ name: "ui", sort: "order" }];

/** The layers of the board: the board fixture's three, and `ui` declared as the ward does. */
const BOARD_LAYERS: readonly LayerSpec[] = [...LAYERS, { name: "ui", sort: "order" }];

/** The list of the ward scene. */
const WARD_NAMES = ["ward", "hud"] as const;

/** The list of the board scene: a backdrop screen, the items and the HUD both scenes list. */
const BOARD_NAMES = ["board.back", BOARD, "hud"] as const;

/** The model root of these tests: the board items and the HUD's coins. */
type Model = { items: Item[]; hud: { coins: number } };

/** Two items on the board. */
const ITEMS: Item[] = [
  { id: "a", level: 1, x: 0, y: 0 },
  { id: "b", level: 2, x: 10, y: 0 }
];

/**
 * A screen projection: one description node per call, drawn in the layer the test names.
 *
 * @param name - The projection name, also its one key.
 * @param layer - The layer it draws in.
 * @returns The spec.
 */
function screen(name: string, layer: string): AnyProjectionSpec {
  return projection({
    name,
    layer,
    from: (player: Model) => player.hud,
    view: (hud: Model["hud"]): DescriptionNode => ({
      type: "box",
      props: { coins: hud.coins },
      children: []
    })
  }) as AnyProjectionSpec;
}

/**
 * A started world showing the ward: `ward` and `hud` mounted, `board.back` and the board items
 * registered for the board scene.
 *
 * @param items - The board items the player holds.
 * @param motion - Motion hooks of the board items.
 * @returns The world.
 */
function wardWorld(items: Item[] = ITEMS, motion?: ProjectionMotion<Item>): MockWorld {
  const world = createMockWorld();

  world.model.player = { items, hud: { coins: 5 } };
  world.api.projection.setLayers(WARD_LAYERS);
  world.api.projection.register(screen("ward", "ui"));
  world.api.projection.register(screen("hud", "ui"));
  world.api.projection.register(screen("board.back", "board"));
  world.api.projection.register(boardItems(motion));
  world.start();
  world.api.projection.mount(WARD_NAMES, MOUNT_OWNER);

  return world;
}

/**
 * Starts the build of the board scene with a budget of 4 ms.
 *
 * @param world - The world showing the ward.
 * @returns What `build` answered.
 */
function buildBoard(world: MockWorld): boolean {
  return world.api.projection.build(BOARD_NAMES, MOUNT_OWNER, BOARD_LAYERS, 4);
}

/**
 * The swap as `scenes` does it: the board's layers, the ward out, the build in.
 *
 * @param world - The world with the board built aside.
 */
function commitBoard(world: MockWorld): void {
  world.api.projection.setLayers(BOARD_LAYERS);
  world.api.projection.unmount(["ward"]);
  world.api.projection.commit();
}

/**
 * The entity of the one root of a screen projection.
 *
 * @param world - The world.
 * @param name - The screen projection.
 * @returns Its entity, mounted or building.
 */
function rootOf(world: MockWorld, name: string): Entity {
  return world.api.projection.entitiesOf(name)[0] ?? 0;
}

/**
 * What a scene stands as: every mounted projection with its `Order` and whether it holds the
 * current layer list, and its views by key with the `Order` they draw at.
 *
 * @param world - The world.
 * @returns The picture, comparable across two worlds.
 */
function sceneOf(world: MockWorld): unknown[] {
  const state = world.ctx.state.projection;

  return [...state.mounted].map(([name, mounted]) => ({
    name,
    order: mounted.order,
    current: mounted.layers === world.api.projection.layers(),
    views: world.api.projection.entitiesOf(name).map(entity => ({
      key: world.api.projection.keyOf(entity)?.key,
      order: world.api.ecs.get(entity, Order)?.value,
      kind: world.api.ecs.get(entity, Transform) === undefined ? "screen" : "item"
    }))
  }));
}

describe("projection.build", () => {
  // Bug: the build writes into the mounted table, so the ward's frame sees the board early; or it checks the board's
  // layers against the ward's list and throws for `items`.
  it("mounts the coming list aside under the coming layers, the mounted table untouched until the commit", () => {
    const world = wardWorld();

    expect(buildBoard(world)).toBe(true);

    const items = world.api.projection.entitiesOf(BOARD);

    expect([...world.ctx.state.projection.mounted.keys()]).toEqual(["ward", "hud"]);
    expect(world.api.projection.layers()).toEqual(WARD_LAYERS);
    expect(world.api.projection.entityOf(BOARD, "a")).toBeUndefined();
    expect(items.map(entity => world.api.projection.keyOf(entity)?.key)).toEqual(["a", "b"]);
    expect(items.every(entity => world.api.projection.isBuilding(entity))).toBe(true);
    // The backdrop's root already draws at its place in the coming list.
    expect(world.api.ecs.get(rootOf(world, "board.back"), Order)?.value).toBe(-3);
  });

  // Bug: a projection both scenes list is built a second time beside its live twin.
  it("leaves a projection both lists name as it is: the same entity, never flagged, not rebuilt", () => {
    const world = wardWorld();
    const hud = rootOf(world, "hud");
    const before = world.api.ecs.count();

    buildBoard(world);

    expect(rootOf(world, "hud")).toBe(hud);
    expect(world.api.projection.isBuilding(hud)).toBe(false);
    // The backdrop and the two items, nothing for the HUD.
    expect(world.api.ecs.count()).toBe(before + 3);
  });

  // Bug: the again case starts a build (or half of one) the scene then mounts a second time in one block.
  it("answers false and touches nothing when a listed projection is mounted under other layer rules", () => {
    const world = wardWorld();
    const layers = world.api.projection.layers();
    const before = world.api.ecs.count();

    expect(
      world.api.projection.build(
        ["hud", BOARD],
        MOUNT_OWNER,
        [...LAYERS, { name: "ui", sort: "none" }],
        4
      )
    ).toBe(false);
    expect([...world.ctx.state.projection.mounted.keys()]).toEqual(["ward", "hud"]);
    expect(world.api.projection.layers()).toBe(layers);
    expect(world.api.ecs.count()).toBe(before);
    expect(world.api.projection.left()).toBe(Number.POSITIVE_INFINITY);
    expect(buildBoard(world)).toBe(true);
  });

  // Bug: a second build replaces the running table and orphans its entities.
  it("throws while a build runs and keeps the running one", () => {
    const world = wardWorld();

    buildBoard(world);

    const item = world.api.projection.entitiesOf(BOARD)[0] ?? 0;

    expect(() => buildBoard(world)).toThrow(
      "[game] A scene is already being built.\n" +
        "  Commit or discard the running build before the next one starts."
    );
    expect(world.api.projection.isBuilding(item)).toBe(true);
  });

  // Bug: a missing layer is found after the build spawned, or leaves a build running.
  it("throws for a layer the coming list does not declare, and builds nothing", () => {
    const world = wardWorld();
    const before = world.api.ecs.count();

    expect(() => world.api.projection.build([BOARD], MOUNT_OWNER, WARD_LAYERS, 4)).toThrow(
      'names layer "items", which the scene does not declare'
    );
    expect(world.api.ecs.count()).toBe(before);
    expect(world.api.projection.left()).toBe(Number.POSITIVE_INFINITY);
  });

  // Bug: a throwing view is logged as in a mount and the scene commits half built; or its spawned views stay.
  it("throws a view's throw on, after every entity the build spawned is gone again", () => {
    const world = wardWorld();
    const before = world.api.ecs.count();

    world.api.projection.replace(
      projection({
        name: BOARD,
        layer: "items",
        from: (player: Model) => player.items,
        key: (item: Item) => item.id,
        view: (item: Item) => {
          if (item.id === "b") throw new Error("no sprite for b");

          return [Transform({ x: item.x, y: item.y, scale: 1 })];
        }
      }) as AnyProjectionSpec
    );

    expect(() => buildBoard(world)).toThrow("no sprite for b");
    expect(world.api.ecs.count()).toBe(before);
    expect(world.api.projection.entitiesOf("board.back")).toEqual([]);
    expect(world.api.projection.built()).toBe(false);
    expect(world.log.error).not.toHaveBeenCalled();
  });
});

describe("projection.commit", () => {
  // Bug: the committed projections draw at other places or under another layer list than a one-block mount gives.
  it("gives the projections the same Order, places and layer list as a one-block mount of the same list", () => {
    const built = wardWorld();
    const block = wardWorld();

    buildBoard(built);
    commitBoard(built);
    block.api.projection.setLayers(BOARD_LAYERS);
    block.api.projection.unmount(["ward"]);
    block.api.projection.mount(BOARD_NAMES, MOUNT_OWNER);

    expect(sceneOf(built)).toEqual(sceneOf(block));
    expect(built.api.projection.entityOf(BOARD, "a")).toBeDefined();
    expect(
      built.api.projection.entitiesOf(BOARD).some(entity => built.api.projection.isBuilding(entity))
    ).toBe(false);
    expect(built.api.projection.built()).toBe(false);
  });

  // Bug: a committed record keeps the coming list as the caller handed it, so the next scene meets it under that
  // very array and takes it for "mounted into this scene already".
  it("stamps the layer list setLayers stored, so a next scene keeps the projection by identity", () => {
    const world = wardWorld();

    buildBoard(world);
    commitBoard(world);

    const items = world.api.projection.entitiesOf(BOARD);

    // A shop that shares the board's layer list and lists the board items too.
    world.api.projection.register(screen("shop", "ui"));

    expect(world.api.projection.build([BOARD, "shop"], MOUNT_OWNER, BOARD_LAYERS, 4)).toBe(true);
    expect(world.log.warn).not.toHaveBeenCalledWith("world:already-mounted", expect.anything());
    expect(world.api.projection.entitiesOf(BOARD)).toEqual(items);
    expect(world.api.projection.isBuilding(items[0] ?? 0)).toBe(false);

    // A second mount under the stored list is one of the same scene.
    world.api.projection.discard();
    world.api.projection.mount(BOARD_NAMES, MOUNT_OWNER);

    expect(world.log.warn).toHaveBeenCalledWith("world:already-mounted", { projection: BOARD });
  });

  // Bug: the loops of the coming scene run unseen during the build, or never start after a commit that nothing
  // left with (no unmount owes a loop then).
  it("starts the loops of the moved views in the first sweep after the commit, never during the build", () => {
    const loop = vi.fn((view: ViewHandle<Item>) =>
      view.tween(Transform, { scale: 1.1 }, { ms: 1000, additive: true, repeat: "forever" })
    );
    const world = wardWorld(ITEMS, { loop });

    // The coming scene lists the ward too: nothing leaves.
    world.api.projection.build([...BOARD_NAMES, "ward"], MOUNT_OWNER, BOARD_LAYERS, 4);
    world.frame(16);
    world.frame(16);

    expect(loop).not.toHaveBeenCalled();

    world.api.projection.setLayers(BOARD_LAYERS);
    world.api.projection.commit();
    world.frame(16);

    expect(loop).toHaveBeenCalledTimes(2);
  });

  // Bug: a projection the build kept and that left before the swap stays an empty record: the scene misses it.
  it("mounts, direct, a projection the build kept that left before the commit", () => {
    const world = wardWorld();

    buildBoard(world);
    world.api.projection.unmount(["hud"]);
    commitBoard(world);

    const hud = rootOf(world, "hud");

    expect(world.api.projection.entityOf("hud", "hud")).toBe(hud);
    expect(world.api.ecs.get(hud, Order)?.value).toBe(-1);
  });

  // Bug: an abort path that commits or discards twice throws, or moves records of no build.
  it("does nothing without a build, and so does discard", () => {
    const world = wardWorld();
    const before = sceneOf(world);
    const count = world.api.ecs.count();

    world.api.projection.commit();
    world.api.projection.discard();

    expect(sceneOf(world)).toEqual(before);
    expect(world.api.ecs.count()).toBe(count);
  });
});

describe("projection.discard", () => {
  // Bug: an abort leaves the coming scene's entities behind, plays their exits, or touches the ward.
  it("despawns every entity of the build with no motion, the adopted ones too, and leaves the ward as it was", () => {
    const exit = vi.fn(() => undefined);
    const world = wardWorld(ITEMS, { exit });
    const ward = sceneOf(world);
    const layers = world.api.projection.layers();
    const before = world.api.ecs.count();

    buildBoard(world);

    const item = world.api.projection.entitiesOf(BOARD)[0] ?? 0;
    const element = world.api.ecs.spawn({ kind: "plugin", name: "ui" }, []);

    world.api.projection.adopt(element);
    world.api.projection.discard();

    expect(world.api.ecs.count()).toBe(before);
    expect(world.api.ecs.ownerOf(element)).toBeUndefined();
    expect(world.api.projection.causeOf(item)).toBe("discard");
    expect(exit).not.toHaveBeenCalled();
    expect(sceneOf(world)).toEqual(ward);
    expect(world.api.projection.layers()).toBe(layers);
    expect(world.api.projection.entitiesOf(BOARD)).toEqual([]);
    expect(world.api.projection.isBuilding(item)).toBe(false);
  });

  // Bug: the discard leaves a record or a view address behind, so the next mount of the same names fails or skips.
  it("lets a later mount of the same names work", () => {
    const world = wardWorld();

    buildBoard(world);
    world.api.projection.discard();
    world.api.projection.setLayers(BOARD_LAYERS);
    world.api.projection.unmount(["ward"]);
    world.api.projection.mount(BOARD_NAMES, MOUNT_OWNER);

    expect(
      world.api.projection.entitiesOf(BOARD).map(e => world.api.projection.keyOf(e)?.key)
    ).toEqual(["a", "b"]);
    expect(world.api.projection.entityOf("board.back", "board.back")).toBeDefined();
  });
});

describe("projection.left", () => {
  // Bug: the frame start is never moved, so after the first frame the budget is spent for good; or it counts
  // without a build.
  it("counts the build's budget down on the game clock from the start of each frame, Infinity without a build", () => {
    const world = wardWorld();

    expect(world.api.projection.left()).toBe(Number.POSITIVE_INFINITY);

    world.api.projection.build(BOARD_NAMES, MOUNT_OWNER, BOARD_LAYERS, 4);
    world.clock.advance(1);

    expect(world.api.projection.left()).toBe(3);

    world.clock.advance(4);

    expect(world.api.projection.left()).toBe(-1);

    world.frame(16);

    expect(world.api.projection.left()).toBe(4);

    world.clock.advance(2);

    expect(world.api.projection.left()).toBe(2);

    commitBoard(world);

    expect(world.api.projection.left()).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("projection.built, onBuild, isBuilding and adopt", () => {
  // Bug: the scene commits before the renderer or ui is done, or with no build at all.
  it("answers built only while a build runs and every registered check answers true", () => {
    const world = wardWorld();
    const parts = { renderer: true, ui: true };

    world.api.projection.onBuild(() => parts.renderer);

    const offUi = world.api.projection.onBuild(() => parts.ui);

    expect(world.api.projection.built()).toBe(false);

    buildBoard(world);

    expect(world.api.projection.built()).toBe(true);

    parts.ui = false;

    expect(world.api.projection.built()).toBe(false);

    offUi();
    offUi();

    expect(world.api.projection.built()).toBe(true);
  });

  // Bug: an element marked outside a build stays marked, or the commit leaves it building for good.
  it("marks an adopted entity only while a build runs, and the commit clears the mark", () => {
    const world = wardWorld();
    const early = world.api.ecs.spawn({ kind: "plugin", name: "ui" }, []);

    world.api.projection.adopt(early);
    buildBoard(world);

    const element = world.api.ecs.spawn({ kind: "plugin", name: "ui" }, []);

    world.api.projection.adopt(element);

    expect(world.api.projection.isBuilding(early)).toBe(false);
    expect(world.api.projection.isBuilding(element)).toBe(true);

    commitBoard(world);

    expect(world.api.projection.isBuilding(element)).toBe(false);
  });
});

describe("a commit of the store during a build", () => {
  // Bug: the coming scene shows the state of the build start after the swap, or plays an enter nobody sees.
  it("reaches the projections built aside, direct: a new key enters flagged building, with no enter hook", () => {
    const enter = vi.fn(() => undefined);
    const world = wardWorld(ITEMS, { enter });

    buildBoard(world);
    world.model.player = {
      items: [...ITEMS, { id: "c", level: 1, x: 20, y: 0 }],
      hud: { coins: 5 }
    };
    world.commit();
    world.frame(16);

    const items = world.api.projection.entitiesOf(BOARD);

    expect(items.map(entity => world.api.projection.keyOf(entity)?.key)).toEqual(["a", "b", "c"]);
    expect(items.every(entity => world.api.projection.isBuilding(entity))).toBe(true);
    expect(enter).not.toHaveBeenCalled();
  });
});
