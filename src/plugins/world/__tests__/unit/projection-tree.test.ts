import { describe, expect, it, vi } from "vitest";
import { Layer, Order, Tree } from "../../ecs/define";
import { projection } from "../../projection/define";
import type { AnyProjectionSpec, DescriptionNode } from "../../projection/types";
import { MOUNT_OWNER } from "./board";
import { createMockWorld } from "./mock-world";

// ---------------------------------------------------------------------------
// Unit test: a projection that draws a screen — `from` returns one plain object,
// `key` is omitted and `view` returns one description node, wrapped as [Tree].
// ---------------------------------------------------------------------------

const HUD = "hud";

type Hud = { coins: number };

/**
 * Builds one description node, the structural shape `ui` hands the world.
 *
 * @param coins - What the label shows.
 * @returns The node.
 */
function hudNode(coins: number): DescriptionNode {
  return { type: "box", props: { coins }, children: [] };
}

describe("projection without a key", () => {
  it("projects one plain object under the name of the projection", () => {
    const world = createMockWorld();
    const view = vi.fn((hud: Hud) => [Tree({ node: hudNode(hud.coins) })]);

    world.model.player = { hud: { coins: 5 } };
    world.api.projection.setLayers([{ name: "ui", sort: "none" }]);
    world.api.projection.register(
      projection({
        name: HUD,
        layer: "ui",
        from: (player: { hud: Hud }) => player.hud,
        view
      }) as AnyProjectionSpec
    );
    world.start();
    world.api.projection.mount([HUD], MOUNT_OWNER);

    const entity = world.api.projection.entityOf(HUD, HUD) ?? 0;

    expect(view).toHaveBeenCalledTimes(1);
    expect(world.api.projection.keyOf(entity)).toEqual({ projection: HUD, key: HUD });
    expect(world.api.ecs.get(entity, Tree)?.node).toEqual(hudNode(5));
  });

  it("reports a list without a key and projects nothing", () => {
    const world = createMockWorld();

    world.model.player = { hud: [{ coins: 5 }] };
    world.api.projection.setLayers([{ name: "ui", sort: "none" }]);
    world.api.projection.register(
      projection({
        name: HUD,
        layer: "ui",
        from: (player: { hud: Hud[] }) => player.hud,
        view: () => []
      }) as AnyProjectionSpec
    );
    world.start();
    world.api.projection.mount([HUD], MOUNT_OWNER);

    expect(world.log.error).toHaveBeenCalledWith(
      "world:projection-failed",
      { projection: HUD },
      expect.any(Error)
    );
    expect(world.api.projection.entityOf(HUD, HUD)).toBeUndefined();
  });
});

/**
 * Mounts a screen projection whose `view` returns the node the test swaps.
 *
 * @param world - The mock world.
 * @param node - A reader of the node the next `view` call returns.
 * @param changed - Called by the `Tree` change hook.
 * @returns The entity of the screen.
 */
function mountScreen(
  world: ReturnType<typeof createMockWorld>,
  node: () => DescriptionNode,
  changed?: () => void
): number {
  world.model.player = { hud: { coins: 5 } };
  world.api.projection.setLayers([{ name: "ui", sort: "none" }]);
  world.api.projection.register(
    projection({
      name: HUD,
      layer: "ui",
      from: (player: { hud: Hud }) => player.hud,
      view: () => node(),
      ...(changed === undefined ? {} : { motion: { change: { Tree: () => changed() } } })
    }) as AnyProjectionSpec
  );
  world.start();
  world.api.projection.mount([HUD], MOUNT_OWNER);

  return world.api.projection.entityOf(HUD, HUD) ?? 0;
}

describe("projection Tree", () => {
  it("wraps a single description node as the Tree component", () => {
    const world = createMockWorld();
    const node = hudNode(5);
    const entity = mountScreen(world, () => node);

    expect(world.api.ecs.get(entity, Tree)?.node).toBe(node);
  });

  it("writes the new node when no hook owns Tree", () => {
    const world = createMockWorld();
    let node = hudNode(5);
    const entity = mountScreen(world, () => node);

    node = hudNode(9);
    world.model.player = { hud: { coins: 9 } };
    world.commit();
    world.frame(16);

    expect(world.api.ecs.get(entity, Tree)?.node).toBe(node);
  });

  it("diffs the node by identity, not by its contents", () => {
    const world = createMockWorld();
    let node = hudNode(5);
    const changed = vi.fn();

    mountScreen(world, () => node, changed);

    // A new item object with the very same node: nothing changed.
    world.model.player = { hud: { coins: 5 } };
    world.commit();
    world.frame(16);

    expect(changed).not.toHaveBeenCalled();

    // A new node object with the same contents: changed, because Tree diffs by identity.
    node = hudNode(5);
    world.model.player = { hud: { coins: 5 } };
    world.commit();
    world.frame(16);

    expect(changed).toHaveBeenCalledTimes(1);
  });
});

describe("the Layer of a screen", () => {
  it("is attached before Tree, so the Tree hook of a projection in layer scene reads scene", () => {
    const world = createMockWorld();
    const read: Array<string | undefined> = [];

    world.model.player = { hud: { coins: 5 } };
    world.api.projection.setLayers([
      { name: "scene", sort: "none" },
      { name: "ui", sort: "none" }
    ]);
    world.api.projection.register(
      projection({
        name: HUD,
        layer: "scene",
        from: (player: { hud: Hud }) => player.hud,
        view: (hud: Hud) => [Tree({ node: hudNode(hud.coins) })]
      }) as AnyProjectionSpec
    );
    world.start();
    world.api.ecs.onAdded(Tree, entity => read.push(world.api.ecs.get(entity, Layer)?.name));
    world.api.projection.mount([HUD], MOUNT_OWNER);

    expect(read).toEqual(["scene"]);
  });
});

/**
 * Registers three screens in layer `ui` and mounts them in one list, as a scene mounts its
 * projections.
 *
 * @param world - The mock world.
 * @param node - The node every `view` returns.
 * @param read - Called by a `Tree` hook opened before the mount.
 * @param changes - The `change` hooks of the three projections, by component name.
 * @returns The entities of the three roots, in list order.
 */
function mountThree(
  world: ReturnType<typeof createMockWorld>,
  node: () => DescriptionNode,
  read?: (entity: number) => void,
  changes?: Record<string, () => undefined>
): number[] {
  const names = ["first", "second", "third"];

  world.model.player = { hud: { coins: 5 } };
  world.api.projection.setLayers([{ name: "ui", sort: "order" }]);

  for (const name of names) {
    world.api.projection.register(
      projection({
        name,
        layer: "ui",
        from: (player: { hud: Hud }) => player.hud,
        view: () => node(),
        ...(changes === undefined ? {} : { motion: { change: changes } })
      }) as AnyProjectionSpec
    );
  }

  world.start();
  if (read !== undefined) world.api.ecs.onAdded(Tree, read);
  world.api.projection.mount(names, MOUNT_OWNER);

  return names.map(name => world.api.projection.entityOf(name, name) ?? 0);
}

describe("the Order of a screen root (spec 16 U1.6)", () => {
  // Bug (C1): every root sorts at 0, so the roots of a scene draw in the order they were mounted.
  it("gives the root of the k-th of n projections Order k - n - 1", () => {
    const world = createMockWorld();
    const roots = mountThree(world, () => hudNode(5));

    expect(roots.map(entity => world.api.ecs.get(entity, Order)?.value)).toEqual([-3, -2, -1]);
  });

  // Bug: Order comes after Tree, so the hook of ui reads no order and the root draws at 0.
  it("attaches Order before Tree, so the Tree hook reads it", () => {
    const world = createMockWorld();
    const read: Array<number | undefined> = [];

    mountThree(
      world,
      () => hudNode(5),
      entity => read.push(world.api.ecs.get(entity, Order)?.value)
    );

    expect(read).toEqual([-3, -2, -1]);
  });

  // Bug: every new node writes the root's Order again, which resorts the layer every render.
  it("writes no Order for a new node of the same root", () => {
    const world = createMockWorld();
    let node = hudNode(5);
    const changed = { Tree: vi.fn(() => undefined), Order: vi.fn(() => undefined) };

    mountThree(world, () => node, undefined, changed);
    world.frame(16);
    node = hudNode(9);
    world.model.player = { hud: { coins: 9 } };
    world.commit();
    world.frame(16);

    expect(changed.Tree).toHaveBeenCalledTimes(3);
    expect(changed.Order).not.toHaveBeenCalled();
  });
});
