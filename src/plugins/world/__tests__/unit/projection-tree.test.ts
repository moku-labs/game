import { describe, expect, it, vi } from "vitest";
import { Tree } from "../../ecs/define";
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
