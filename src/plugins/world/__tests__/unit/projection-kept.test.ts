import { describe, expect, it, vi } from "vitest";
import { Order, Tree } from "../../ecs/define";
import { projection } from "../../projection/define";
import type { AnyProjectionSpec, DescriptionNode } from "../../projection/types";
import { BOARD, commitItems, LAYERS, MOUNT_OWNER, mountBoard, Transform } from "./board";
import { createMockWorld, type MockWorld } from "./mock-world";

// ---------------------------------------------------------------------------
// Unit test (F23): `mount` of a list that names a projection a scene before
// mounted, as a scene switch does for a projection both scenes list: the new
// scene's layers first, then its list. The projection stays: its views keep
// their entities and their motions, and its screen roots take the `Order` of
// their place in the new list (spec 16 U1.6).
// ---------------------------------------------------------------------------

/** The one layer of every scene of these tests. */
const UI_LAYERS = [{ name: "ui", sort: "order" }] as const;

/**
 * Stores the layer list of the scene that comes, as `scenes` does before it mounts its list.
 *
 * @param world - The mock world.
 */
function nextScene(world: MockWorld): void {
  world.api.projection.setLayers(UI_LAYERS);
}

/** The model root every screen of these tests reads. */
type Hud = { coins: number };

/**
 * One description node, the structural shape `ui` hands the world.
 *
 * @param coins - What the screen shows.
 * @returns The node.
 */
function hudNode(coins: number): DescriptionNode {
  return { type: "box", props: { coins }, children: [] };
}

/**
 * Registers one screen projection whose `view` returns a new node per call.
 *
 * @param world - The mock world.
 * @param name - The projection name, also its one key.
 * @param changes - The `change` hooks of the projection, by component name.
 * @param layer - The layer it draws in.
 */
function registerScreen(
  world: MockWorld,
  name: string,
  changes?: Record<string, () => undefined>,
  layer = "ui"
): void {
  world.api.projection.register(
    projection({
      name,
      layer,
      from: (player: { hud: Hud }) => player.hud,
      view: (hud: Hud) => hudNode(hud.coins),
      ...(changes === undefined ? {} : { motion: { change: changes } })
    }) as AnyProjectionSpec
  );
}

/**
 * A started world with the screens `a`, `hud`, `b` and `c` registered in a `ui` layer sorted by
 * order, and the list `[a, hud]` mounted: the root of `hud` draws at -1.
 *
 * @param changes - The `change` hooks of `hud`.
 * @returns The world and the entity of the root of `hud`.
 */
function mountedHud(changes?: Record<string, () => undefined>): {
  world: MockWorld;
  hud: number;
} {
  const world = createMockWorld();

  world.model.player = { hud: { coins: 5 } };
  world.api.projection.setLayers(UI_LAYERS);
  registerScreen(world, "a");
  registerScreen(world, "hud", changes);
  registerScreen(world, "b");
  registerScreen(world, "c");
  world.start();
  world.api.projection.mount(["a", "hud"], MOUNT_OWNER);

  return { world, hud: world.api.projection.entityOf("hud", "hud") ?? 0 };
}

describe("mount of a list that names a projection already mounted", () => {
  it("keeps its views: the same entity, never removed, never added again", () => {
    const { world, hud } = mountedHud();
    const removed: number[] = [];
    const added: number[] = [];

    world.api.ecs.onRemoved(Tree, entity => removed.push(entity));
    world.api.ecs.onAdded(Tree, entity => added.push(entity));
    nextScene(world);
    world.api.projection.unmount(["a"]);
    world.api.projection.mount(["hud", "b"], MOUNT_OWNER);

    expect(world.api.projection.entityOf("hud", "hud")).toBe(hud);
    expect(world.api.ecs.ownerOf(hud)).toBeDefined();
    expect(removed).not.toContain(hud);
    expect(added).toEqual([world.api.projection.entityOf("b", "b")]);
  });

  it("gives its screen root the Order of its new place, and a later node writes no Order", () => {
    const changed = { Tree: vi.fn(() => undefined), Order: vi.fn(() => undefined) };
    const { world, hud } = mountedHud(changed);

    expect(world.api.ecs.get(hud, Order)?.value).toBe(-1);

    nextScene(world);
    world.api.projection.unmount(["a"]);
    world.api.projection.mount(["hud", "b", "c"], MOUNT_OWNER);

    expect(world.api.ecs.get(hud, Order)?.value).toBe(-3);
    expect(world.api.projection.restOf(hud, Order)?.value).toBe(-3);

    // A new node of the same root: its Order is the one of its new place already.
    world.model.player = { hud: { coins: 9 } };
    world.commit();
    world.frame(16);

    expect(changed.Tree).toHaveBeenCalledTimes(1);
    expect(changed.Order).not.toHaveBeenCalled();
    expect(world.api.ecs.get(hud, Order)?.value).toBe(-3);
  });

  it("leaves the Order a view that returns its own components gave itself", () => {
    const world = createMockWorld();

    world.model.player = { hud: { coins: 5 } };
    world.api.projection.setLayers(UI_LAYERS);
    world.api.projection.register(
      projection({
        name: "badge",
        layer: "ui",
        from: (player: { hud: Hud }) => player.hud,
        view: (hud: Hud) => [Order({ value: 7 }), Tree({ node: hudNode(hud.coins) })]
      }) as AnyProjectionSpec
    );
    registerScreen(world, "hud");
    world.start();
    world.api.projection.mount(["badge", "hud"], MOUNT_OWNER);

    const badge = world.api.projection.entityOf("badge", "badge") ?? 0;

    nextScene(world);
    world.api.projection.mount(["hud", "badge"], MOUNT_OWNER);

    expect(world.api.ecs.get(badge, Order)?.value).toBe(7);
    expect(world.api.ecs.get(world.api.projection.entityOf("hud", "hud") ?? 0, Order)?.value).toBe(
      -2
    );
  });

  it("keeps the motions of its views running", () => {
    const world = createMockWorld();

    mountBoard(world, [{ id: "a", level: 1, x: 0, y: 0 }], {
      change: { Transform: view => view.toRest(Transform, { ms: 350, ease: "linear" }) }
    });

    const entity = world.api.projection.entityOf(BOARD, "a") ?? 0;

    commitItems(world, [{ id: "a", level: 1, x: 100, y: 0 }]);
    world.frame(16);

    expect(world.api.projection.motionsOf(entity)).toEqual(["Transform"]);

    world.api.projection.setLayers(LAYERS);
    world.api.projection.mount([BOARD], MOUNT_OWNER);

    expect(world.api.projection.motionsOf(entity)).toEqual(["Transform"]);
    expect(world.api.ecs.get(entity, Transform)?.x).toBeLessThan(100);
  });

  // Bug: the renderer keeps the container of a layer that stays but never sorts a kept view
  // again, so under the new rule the kept root draws and is hit at its old place.
  it("mounts it again when its layer is declared otherwise in the new list", () => {
    const { world, hud } = mountedHud();
    const removed: number[] = [];

    world.api.ecs.onRemoved(Tree, entity => removed.push(entity));
    world.api.projection.setLayers([{ name: "ui", sort: "none" }]);
    world.api.projection.unmount(["a"]);
    world.api.projection.mount(["hud", "b"], MOUNT_OWNER);

    const again = world.api.projection.entityOf("hud", "hud");

    expect(removed).toContain(hud);
    expect(again).toBeDefined();
    expect(again).not.toBe(hud);
    expect(world.api.ecs.get(again ?? 0, Order)?.value).toBe(-2);
    expect(world.api.projection.causeOf(hud)).toBe("mount");
  });

  it("checks its layers against the scene too, and mounts nothing when one is missing", () => {
    const world = createMockWorld();

    world.model.player = { hud: { coins: 5 } };
    world.api.projection.setLayers(UI_LAYERS);
    registerScreen(world, "hud");
    registerScreen(world, "b", undefined, "scene");
    world.start();
    world.api.projection.mount(["hud"], MOUNT_OWNER);
    world.api.projection.setLayers([{ name: "scene", sort: "none" }]);

    expect(() => world.api.projection.mount(["hud", "b"], MOUNT_OWNER)).toThrow(
      'names layer "ui", which the scene does not declare'
    );
    expect(world.api.projection.entityOf("b", "b")).toBeUndefined();
  });
});
