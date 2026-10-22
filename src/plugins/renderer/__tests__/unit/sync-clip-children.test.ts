import { afterEach, describe, expect, it, vi } from "vitest";
import { Order } from "../../../world/ecs/define";
import type { Entity } from "../../../world/types";
import { Parent, Shape, Transform } from "../../components";
import { type Drawn, OWNER, startDrawn } from "../demand-harness";

// ---------------------------------------------------------------------------
// A view that starts clipping moves all its children into the masked container,
// over the real Pixi of `stagePixi`: a child left in the wrapper is drawn
// unmasked and grows the bounds of every picture of the view.
// ---------------------------------------------------------------------------

const running: Drawn[] = [];

afterEach(() => {
  for (const drawn of running.splice(0)) drawn.mock.stop();
  vi.restoreAllMocks();
});

describe("a view that starts clipping", () => {
  // Bug F57: the children were moved while the wrapper's own list was walked; each move shortened the list, so every
  // other child stayed outside the mask (a kept fade picture of 2623 x 2444 px on the A26).
  it("moves every child under the mask, not every other one", async () => {
    const drawn = await startDrawn({ onDemand: false });

    running.push(drawn);

    const panel = drawn.spawn(Transform({ x: 40, y: 40 }), Shape({ w: 200, h: 100 }));

    drawn.frame();

    const children: Entity[] = [1, 2, 3, 4].map(order =>
      drawn.mock.world.ecs.spawn(OWNER, [
        Transform({ x: 20 * order, y: 20 }),
        Shape({ w: 40, h: 40 }),
        Order({ value: order }),
        Parent({ entity: panel })
      ])
    );

    drawn.frames(2);
    drawn.mock.world.ecs.set(panel, Shape, { clip: true });
    drawn.frame();

    const view = drawn.mock.ctx.state.sync.views.get(panel);

    for (const child of children) {
      expect(drawn.objectOf(child)?.parent).toBe(view?.clipped);
    }
    expect(view?.object.parent).toBe(view?.wrapper);
  });
});
