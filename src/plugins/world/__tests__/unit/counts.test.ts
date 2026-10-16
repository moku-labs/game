import { describe, expect, it } from "vitest";
import { BOARD, boardItems, LAYERS, MOUNT_OWNER, settleFrames } from "./board";
import { createMockWorld } from "./mock-world";

// ---------------------------------------------------------------------------
// Unit: `ecs.count()` as the offline leak detector (telemetry U3). A screen entered and left
// returns the count to its baseline; one that leaves views behind makes it grow.
// ---------------------------------------------------------------------------

const ITEMS = [
  { id: "a", level: 1, x: 0, y: 0 },
  { id: "b", level: 2, x: 10, y: 0 }
];

describe("ecs.count across a projection mounted and unmounted", () => {
  // Bug caught: an unmount that keeps the entities of its views alive grows the count by the
  // board's size on every visit.
  it("comes back to its baseline after every one of five visits", () => {
    const world = createMockWorld();

    world.model.player = { items: ITEMS };
    world.api.projection.setLayers(LAYERS);
    world.api.projection.register(boardItems());
    world.start();
    world.frame();

    const baseline = world.api.ecs.count();

    for (let visit = 0; visit < 5; visit += 1) {
      world.api.projection.mount([BOARD], MOUNT_OWNER);
      world.frame();

      expect(world.api.ecs.count()).toBe(baseline + ITEMS.length);

      world.api.projection.unmount([BOARD]);
      settleFrames(world);

      expect(world.api.ecs.count()).toBe(baseline);
    }
  });
});
