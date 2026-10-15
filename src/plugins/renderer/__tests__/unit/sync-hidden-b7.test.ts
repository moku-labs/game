import * as pixi from "pixi.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Entity } from "../../../world/types";
import { Parent, Shape, Transform } from "../../components";
import { type Drawn, startDrawn } from "../demand-harness";

// ---------------------------------------------------------------------------
// Unit test (real Pixi, the tree oracle every frame): B7 of spec 26 — a Shape that draws nothing (no stroke, and no
// fill alpha or no area) is not renderable through `setHidden("empty")`. Only its own visual leaves Pixi's build and
// its bounds: the children in its wrapper and its clip mask stay, and it keeps its hit box.
// ---------------------------------------------------------------------------

const running: Drawn[] = [];

afterEach(() => {
  for (const drawn of running.splice(0)) {
    drawn.oracle.expectNoMissedFrame();
    drawn.mock.stop();
  }

  vi.unstubAllGlobals();
});

/**
 * Starts the renderer over real Pixi; the test ends it in `afterEach`.
 *
 * @returns The running renderer.
 */
async function started(): Promise<Drawn> {
  const drawn = await startDrawn();

  running.push(drawn);

  return drawn;
}

/**
 * The real Pixi objects of a view: its visual and its top.
 *
 * @param drawn - The running renderer.
 * @param entity - The entity.
 * @returns The visual, the wrapper (or `undefined`) and the clip mask (or `undefined`).
 */
function nodesOf(
  drawn: Drawn,
  entity: Entity
): {
  object: pixi.Container;
  wrapper: pixi.Container | undefined;
  mask: pixi.Container | undefined;
} {
  const view = drawn.mock.ctx.state.sync.views.get(entity);

  if (view === undefined) throw new Error(`no view for ${entity}`);

  return {
    object: view.object as pixi.Container,
    wrapper: view.wrapper as pixi.Container | undefined,
    mask: view.mask as pixi.Container | undefined
  };
}

/**
 * Spawns a child box under a parent.
 *
 * @param drawn - The running renderer.
 * @param parent - The parent entity.
 * @param x - Its x in the parent.
 * @param y - Its y in the parent.
 * @returns The child.
 */
function childOf(drawn: Drawn, parent: Entity, x: number, y: number): Entity {
  return drawn.mock.world.ecs.spawn({ kind: "plugin", name: "test" }, [
    Parent({ entity: parent }),
    Transform({ x, y }),
    Shape({ w: 100, h: 100, fill: 0x33_66_99 })
  ]);
}

describe("B7: an empty Shape is not drawn", () => {
  it("an empty layout box is not drawn but its children and its clip mask are", async () => {
    const drawn = await started();
    const box = drawn.spawn(
      Transform({ x: 10, y: 10 }),
      Shape({ w: 400, h: 300, fillAlpha: 0, clip: true })
    );

    drawn.frame();

    const child = childOf(drawn, box, 20, 20);

    drawn.frames(2);

    const nodes = nodesOf(drawn, box);

    expect(nodes.object.renderable).toBe(false);
    expect(nodes.wrapper?.renderable).toBe(true);
    expect(nodes.mask?.renderable).toBe(true);
    expect(nodesOf(drawn, child).object.renderable).toBe(true);
  });

  it("an empty box still takes a press", async () => {
    const drawn = await started();
    const box = drawn.spawn(Transform({ x: 100, y: 100 }), Shape({ w: 200, h: 200, fillAlpha: 0 }));

    drawn.frame();

    expect(nodesOf(drawn, box).object.renderable).toBe(false);
    expect(drawn.mock.api.sync.hitTest(150, 150, entity => entity === box)).toBe(box);
  });

  it("a box that gains a fill is drawn again in that frame; one that loses it is hidden", async () => {
    const drawn = await started();
    const box = drawn.spawn(Transform({ x: 100, y: 100 }), Shape({ w: 200, h: 200, fillAlpha: 0 }));

    drawn.frames(2);

    const { object } = nodesOf(drawn, box);

    expect(object.renderable).toBe(false);

    drawn.mock.world.ecs.set(box, Shape, { fillAlpha: 1 });

    expect(drawn.frame()).toBe(true);
    expect(object.renderable).toBe(true);
    expect(drawn.frames(3)).toBe(0);

    drawn.mock.world.ecs.set(box, Shape, { w: 0 });

    expect(drawn.frame()).toBe(true);
    expect(object.renderable).toBe(false);
  });

  it("a stroke with a zero side is not empty, nor is a stroke around a box without fill", async () => {
    const drawn = await started();
    const line = drawn.spawn(Transform({ x: 100, y: 100 }), Shape({ w: 0, h: 80, strokeWidth: 2 }));
    const ring = drawn.spawn(
      Transform({ x: 300, y: 100 }),
      Shape({ w: 80, h: 80, fillAlpha: 0, strokeWidth: 2 })
    );

    drawn.frame();

    expect(nodesOf(drawn, line).object.renderable).toBe(true);
    expect(nodesOf(drawn, ring).object.renderable).toBe(true);
  });

  it("a Dim over a strip of empty boxes measures the strip, not the corner", async () => {
    const drawn = await started();
    // A full-screen layout box that draws nothing, with a strip of buttons near the bottom of the screen.
    const screenBox = drawn.spawn(
      Transform({ x: 0, y: 0 }),
      Shape({ w: 1080, h: 1920, fillAlpha: 0 })
    );

    drawn.frame();

    const strip = drawn.mock.world.ecs.spawn({ kind: "plugin", name: "test" }, [
      Parent({ entity: screenBox }),
      Transform({ x: 0, y: 1700 }),
      Shape({ w: 1080, h: 200, fillAlpha: 0 })
    ]);

    drawn.frame();
    childOf(drawn, strip, 40, 50);
    childOf(drawn, strip, 600, 50);
    drawn.frames(2);

    const top = nodesOf(drawn, screenBox).wrapper;

    if (top === undefined) throw new Error("the screen box has no wrapper");

    // The area Pixi gives a filter on the box: its fast global bounds, with the transforms a render updates.
    const stage = drawn.stage.last().stage;

    stage.enableRenderGroup();
    pixi.updateRenderGroupTransforms(Reflect.get(stage, "renderGroup") as pixi.RenderGroup, true);

    const bounds = top.getFastGlobalBounds(true);

    // The two buttons only: 40..700 by 1750..1850, not from the screen's corner.
    expect([bounds.minX, bounds.minY, bounds.maxX, bounds.maxY]).toEqual([40, 1750, 700, 1850]);
  });
});
