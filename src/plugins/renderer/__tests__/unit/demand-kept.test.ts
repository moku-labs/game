import * as pixi from "pixi.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Entity } from "../../../world/types";
import { Parent, Shape, Transform } from "../../components";
import { type Drawn, OWNER, startDrawn } from "../demand-harness";

// ---------------------------------------------------------------------------
// The demand module with kept pictures (spec 23 P10): a kept top is drawn
// through its quad, so a mark under it draws a frame; a move of the kept view
// itself is a move, not a change of its picture; taking a picture marks nothing.
// ---------------------------------------------------------------------------

const running: Drawn[] = [];

afterEach(() => {
  for (const drawn of running.splice(0)) {
    drawn.oracle.expectNoMissedFrame();
    drawn.oracle.expectPicturesCurrent();
    drawn.mock.stop();
  }

  vi.restoreAllMocks();
});

/**
 * Starts the renderer on demand with a lamp that keeps frames drawn while it glides, and a filtered view kept by the
 * end of the glide.
 *
 * @param fields - The shape, transform and filter padding of the filtered view.
 * @param fields.x - Its x.
 * @param fields.padding - The padding of its filter.
 * @returns The renderer and the entities.
 */
async function keptOnDemand(
  fields: { x?: number; padding?: number } = {}
): Promise<{ drawn: Drawn; entity: Entity; child: Entity }> {
  const drawn = await startDrawn({ onDemand: true });
  const lamp = drawn.spawn(Transform({ x: 600, y: 600 }), Shape({ w: 8, h: 8 }));
  const entity = drawn.spawn(Transform({ x: fields.x ?? 100, y: 100 }), Shape({ w: 40, h: 40 }));
  const child = drawn.mock.world.ecs.spawn(OWNER, [
    Transform({ x: 4, y: 4 }),
    Shape({ w: 8, h: 8 }),
    Parent({ entity })
  ]);
  const filter = new pixi.AlphaFilter();

  filter.padding = fields.padding ?? 0;
  running.push(drawn);
  drawn.mock.api.sync.filters.set(entity, [{ filter, passes: 1, cache: "local" }]);

  for (let frame = 1; frame <= 4; frame += 1) {
    drawn.mock.world.ecs.set(lamp, Transform, { x: 600 + frame });
    drawn.frame();
  }

  expect(drawn.mock.ctx.state.kept.byEntity.get(entity)?.mode).toBe("kept");
  expect(drawn.frames(2)).toBe(0);

  return { drawn, entity, child };
}

describe("demand with kept pictures", () => {
  it("a mark under a kept view draws a frame", async () => {
    const { drawn, child } = await keptOnDemand();

    drawn.mock.world.ecs.set(child, Transform, { x: 10 });

    expect(drawn.frame()).toBe(true);
  });

  it("a kept leaf's padding counts for the off-screen test", async () => {
    const drawn = await startDrawn({ onDemand: true });
    const lamp = drawn.spawn(Transform({ x: 600, y: 600 }), Shape({ w: 8, h: 8 }));
    // Its box ends 10 px left of the screen: only the glow of its filter reaches it.
    const leaf = drawn.spawn(Transform({ x: -50, y: 100 }), Shape({ w: 40, h: 40 }));
    const filter = new pixi.AlphaFilter();

    filter.padding = 20;
    running.push(drawn);
    drawn.mock.api.sync.filters.set(leaf, [{ filter, passes: 1, cache: "local" }]);

    for (let frame = 1; frame <= 4; frame += 1) {
      drawn.mock.world.ecs.set(lamp, Transform, { x: 600 + frame });
      drawn.frame();
    }

    expect(drawn.mock.ctx.state.kept.byEntity.get(leaf)?.mode).toBe("kept");

    drawn.mock.world.ecs.set(leaf, Shape, { fill: 0xff_00_00 });

    expect(drawn.frame()).toBe(true);
  });

  it("a move of the kept view itself is a moved mark, not a visual one", async () => {
    const { drawn, entity, child } = await keptOnDemand();
    const demand = drawn.mock.modules.demand;

    drawn.mock.world.ecs.set(entity, Transform, { x: 120 });
    drawn.mock.world.ecs.set(child, Shape, { fill: 0xff_00_00 });
    drawn.mock.modules.sync.pass();

    expect(demand.moved().has(entity)).toBe(true);
    expect(demand.visual().has(entity)).toBe(false);
    expect(demand.visual().has(child)).toBe(true);
    expect(drawn.frame()).toBe(true);
  });

  it("taking a view into its quad writes no mark", async () => {
    const { drawn } = await keptOnDemand();

    // The take of the last glide frame marked nothing: the next decision has no mark, and nothing is drawn.
    expect(drawn.mock.modules.demand.marked().size).toBe(0);
    expect(drawn.frame()).toBe(false);
  });
});
