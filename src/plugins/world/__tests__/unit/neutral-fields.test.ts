import { describe, expect, it } from "vitest";
import { component, withNeutral } from "../../ecs/define";
import { projection } from "../../projection/define";
import type { AnyProjectionSpec } from "../../projection/types";
import { LAYERS, MOUNT_OWNER, settleFrames, viewOf } from "./board";
import { createMockWorld, type MockWorld } from "./mock-world";

// ---------------------------------------------------------------------------
// Unit: the neutral value of an optional numeric field (F179, W2 and W3). `Transform`'s `scaleX` / `scaleY` are left
// out of a rest pose that does not set them; a stored value that carries one is brought home to its neutral 1, and a
// field at its neutral counts as at rest.
// ---------------------------------------------------------------------------

/** A pose with an optional per-axis factor, neutral at 1, as `Transform`'s `scaleX`. */
const Pose = withNeutral(component<{ x: number; scaleX?: number }>("Pose", { x: 0 }), {
  scaleX: 1
});

type Item = { id: string; x: number };

/**
 * Mounts one view of `Pose` whose change hook brings it home with `toRest`.
 *
 * @param world - The mock world.
 * @returns The entity of the view.
 */
function mountPose(world: MockWorld): number {
  world.model.player = { items: [{ id: "a", x: 0 }] } as never;
  world.api.projection.setLayers(LAYERS);
  world.api.projection.register(
    projection({
      name: "board.poses",
      layer: "items",
      from: (player: { items: Item[] }) => player.items,
      key: (item: Item) => item.id,
      view: (item: Item) => [Pose({ x: item.x })],
      motion: { change: { Pose: view => view.toRest(Pose, { ms: 200, ease: "linear" }) } }
    }) as AnyProjectionSpec
  );
  world.start();
  world.api.projection.mount(["board.poses"], MOUNT_OWNER);

  return world.api.projection.entityOf("board.poses", "a") ?? 0;
}

describe("the neutral value of an optional field", () => {
  // Bug W2: toRest takes its targets from the rest's keys alone, so a squeezed view stays squeezed.
  it("brings a field the rest lacks home to its neutral with toRest", () => {
    const world = createMockWorld();
    const entity = mountPose(world);

    world.api.ecs.set(entity, Pose, { scaleX: 0 });
    world.model.player = { items: [{ id: "a", x: 100 }] } as never;
    world.commit();
    settleFrames(world);

    expect(world.api.ecs.get(entity, Pose)).toEqual({ x: 100, scaleX: 1 });
    expect(viewOf(world, "a")?.handles.some(handle => handle.active())).toBe(false);
  });

  // Bug: a field at its neutral that the rest lacks counts as loose, and the view settles forever.
  it("counts a field at its neutral as at rest", () => {
    const world = createMockWorld();
    const entity = mountPose(world);

    world.api.ecs.set(entity, Pose, { scaleX: 1 });
    world.api.projection.settle(entity);

    expect(world.api.ecs.get(entity, Pose)).toEqual({ x: 0, scaleX: 1 });
    expect(viewOf(world, "a")?.handles.some(handle => handle.active())).toBe(false);
  });
});

describe("the neutral value on an instant settle", () => {
  // Bug: `settle(entity)` in a world that is not live writes the rest values as they are, so a squeezed field the rest
  // lacks stays squeezed.
  it("writes a field the rest lacks home to its neutral at once", () => {
    const world = createMockWorld();
    const entity = mountPose(world);

    world.api.ecs.setMode("paused");
    world.api.ecs.set(entity, Pose, { scaleX: 0 });
    world.api.projection.settle(entity);

    expect(world.api.ecs.get(entity, Pose)).toEqual({ x: 0, scaleX: 1 });
  });
});
