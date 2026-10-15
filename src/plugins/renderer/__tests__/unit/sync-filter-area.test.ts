import * as pixi from "pixi.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Parent, Sprite, Transform } from "../../components";
import type { FilterSlot, PixiContainer } from "../../types";
import { type Drawn, startDrawn } from "../demand-harness";
import { createMockRenderer } from "../mock-renderer";

// ---------------------------------------------------------------------------
// Unit test of `sync.filters.area` (B4) on the real Pixi of `stagePixi`: the
// rectangle outside of which a view's filters draw nothing, kept per entity
// like its filters, written into one Rectangle on the view's top in the top's
// own units, the entity marked before every change.
// ---------------------------------------------------------------------------

const running: Drawn[] = [];

afterEach(() => {
  for (const drawn of running.splice(0)) drawn.mock.stop();
  vi.unstubAllGlobals();
});

/**
 * A slot of one lens-like filter: one apply.
 *
 * @returns The slot.
 */
function lensSlot(): FilterSlot {
  return { filter: new pixi.AlphaFilter(), passes: 1, kind: "fixture.lens" };
}

/**
 * The filter area a display object holds: Pixi answers `null` once it has a filter effect, `undefined` before.
 *
 * @param target - The display object.
 * @returns The rectangle as numbers, or `undefined` for none.
 */
function areaOn(target: PixiContainer | undefined): number[] | undefined {
  const held: pixi.Rectangle | null | undefined = target?.filterArea;

  return held === null || held === undefined
    ? undefined
    : [held.x, held.y, held.width, held.height];
}

/**
 * Starts the renderer drawing on demand, with one filtered sprite of 128 × 64 units over the 64 × 64 texture: its
 * stretch, folded into the object's scale, is 2 across and 1 down.
 *
 * @returns The running renderer and the entity.
 */
async function filteredSprite(): Promise<{ drawn: Drawn; entity: number }> {
  const drawn = await startDrawn();
  const entity = drawn.spawn(
    Transform({ x: 100, y: 100 }),
    Sprite({ texture: "card", width: 128, height: 64 })
  );

  running.push(drawn);
  drawn.mock.api.sync.filters.set(entity, [lensSlot()]);
  drawn.frame();

  return { drawn, entity };
}

describe("renderer.sync.filters.area", () => {
  // Bug: the area lands in entity units on an object scaled by its stretch, so Pixi clips at twice the size.
  it("an area lands on the view's filter target in its local units", async () => {
    const { drawn, entity } = await filteredSprite();

    drawn.mock.api.sync.filters.area(entity, [10, 20, 40, 60]);

    expect(areaOn(drawn.objectOf(entity))).toEqual([5, 20, 20, 60]);
    // An area changes the size of the passes, never their number: the frame, the content, one apply.
    expect(drawn.mock.api.sync.renderPasses()).toBe(3);
  });

  // Bug: the area stays on the visual inside the new wrapper, cutting the children the filters now cover.
  it("an area moves to the wrapper when the view gets one", async () => {
    const { drawn, entity } = await filteredSprite();

    drawn.mock.api.sync.filters.area(entity, [10, 20, 40, 60]);
    drawn.spawn(Parent({ entity }), Sprite({ texture: "card", width: 10, height: 10 }));
    drawn.frame();

    const view = drawn.mock.ctx.state.sync.views.get(entity);

    expect(areaOn(view?.wrapper)).toEqual([10, 20, 40, 60]);
    expect(areaOn(view?.object)).toBeUndefined();
  });

  // Bug: every frame writes a new Rectangle or marks the view again, and a still screen keeps drawing.
  it("the same area is not written again; a new one is written into the same Rectangle", async () => {
    const { drawn, entity } = await filteredSprite();
    // The marks of the frame being decided: `demand` clears them when it decides.
    const marked = (): boolean => drawn.mock.ctx.state.demand.visual.has(entity);

    drawn.mock.api.sync.filters.area(entity, [10, 20, 40, 60]);

    const first = drawn.objectOf(entity)?.filterArea;

    expect(marked()).toBe(true);
    expect(drawn.frame()).toBe(true);

    drawn.mock.api.sync.filters.area(entity, [10, 20, 40, 60]);

    expect(marked()).toBe(false);
    expect(drawn.frame()).toBe(false);

    drawn.mock.api.sync.filters.area(entity, [12, 20, 40, 60]);

    expect(marked()).toBe(true);
    expect(drawn.objectOf(entity)?.filterArea).toBe(first);
    expect(areaOn(drawn.objectOf(entity))).toEqual([6, 20, 20, 60]);
    expect(drawn.frame()).toBe(true);
  });

  // Bug: the lens left, but its box still clips the cover.
  it("undefined goes back to the view's bounds", async () => {
    const { drawn, entity } = await filteredSprite();

    drawn.mock.api.sync.filters.area(entity, [10, 20, 40, 60]);
    drawn.frame();
    drawn.mock.api.sync.filters.area(entity, undefined);

    expect(drawn.objectOf(entity)?.filterArea).toBeNull();
    expect(drawn.frame()).toBe(true);
  });

  // Bug: an area handed over in the frame the view is spawned is lost.
  it("an area set while inert, or before the view exists, lands when it is built", async () => {
    const inert = createMockRenderer({ dom: false });

    await inert.start();
    inert.api.sync.filters.area(7, [1, 2, 3, 4]);
    inert.stop();

    const drawn = await startDrawn();
    const entity = drawn.spawn(
      Transform({ x: 0, y: 0 }),
      Sprite({ texture: "card", width: 64, height: 64 })
    );

    running.push(drawn);
    drawn.mock.api.sync.filters.set(entity, [lensSlot()]);
    drawn.mock.api.sync.filters.area(entity, [1, 2, 3, 4]);
    drawn.frame();

    expect(areaOn(drawn.objectOf(entity))).toEqual([1, 2, 3, 4]);
  });

  // Bug: the next entity drawn with a pooled sprite is clipped by the box of the one before.
  it("a pooled object keeps no area", async () => {
    const { drawn, entity } = await filteredSprite();
    const object = drawn.objectOf(entity);

    drawn.mock.api.sync.filters.area(entity, [10, 20, 40, 60]);
    drawn.frame();
    drawn.mock.world.ecs.despawn(entity);
    drawn.frame();

    expect(areaOn(object)).toBeUndefined();
    expect(drawn.mock.ctx.state.sync.areas.has(entity)).toBe(false);
  });

  // Bug: a new stretch of the sprite leaves the area at the old scale.
  it("a new stretch of a view without a wrapper writes its area again", async () => {
    const { drawn, entity } = await filteredSprite();

    drawn.mock.api.sync.filters.area(entity, [10, 20, 40, 60]);
    drawn.mock.world.ecs.set(entity, Sprite, { texture: "card", width: 256, height: 64 });
    drawn.frame();

    expect(areaOn(drawn.objectOf(entity))).toEqual([2.5, 20, 10, 60]);
  });
});
