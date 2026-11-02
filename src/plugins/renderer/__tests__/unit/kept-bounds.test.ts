import * as pixi from "pixi.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Entity } from "../../../world/types";
import { Parent, Shape, Transform } from "../../components";
import type { FilterSlot } from "../../types";
import { type Drawn, OWNER, startDrawn } from "../demand-harness";
import type { RenderCall } from "../stage-pixi";

// ---------------------------------------------------------------------------
// The size of a kept picture (spec 23 P2) over the real Pixi of `stagePixi`:
// the picture holds what Pixi draws of the subtree and what the live filter
// pass would keep of it, no more. The canvas is 1080 x 1920 at resolution 1.
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
 * Starts the renderer, every frame drawn, and keeps it for the teardown.
 *
 * @returns The running renderer.
 */
async function open(): Promise<Drawn> {
  const drawn = await startDrawn({ onDemand: false });

  running.push(drawn);

  return drawn;
}

/**
 * A slot of a real Pixi filter the cache may keep.
 *
 * @returns The slot.
 */
function slot(): FilterSlot {
  return { filter: new pixi.AlphaFilter({ alpha: 0.5 }), passes: 1, cache: "local" };
}

/**
 * The subtree pictures of an entity: the renders whose root is its top.
 *
 * @param drawn - The running renderer.
 * @param entity - The entity.
 * @returns The render calls.
 */
function picturesOf(drawn: Drawn, entity: Entity): RenderCall[] {
  const view = drawn.mock.ctx.state.sync.views.get(entity);
  const top = view?.wrapper ?? view?.object;

  return drawn.stage.targets().filter(call => call.target?.source.label === `kept:${top?.label}#1`);
}

/**
 * The size of the last subtree picture of an entity, CSS px.
 *
 * @param drawn - The running renderer.
 * @param entity - The entity.
 * @returns Width and height.
 */
function lastPicture(drawn: Drawn, entity: Entity): { width: number; height: number } {
  const target = picturesOf(drawn, entity).at(-1)?.target;

  return { width: target?.width ?? 0, height: target?.height ?? 0 };
}

/**
 * Spawns a child shape of a parent.
 *
 * @param drawn - The running renderer.
 * @param parent - The parent.
 * @param x - Its x in the parent.
 * @param alpha - Its alpha.
 * @returns The child.
 */
function child(drawn: Drawn, parent: Entity, x: number, alpha = 1): Entity {
  return drawn.mock.world.ecs.spawn(OWNER, [
    Transform({ x, y: 0 }),
    Shape({ w: 100, h: 100, alpha }),
    Parent({ entity: parent })
  ]);
}

describe("a kept picture holds what is drawn (F58)", () => {
  // Bug F58: the picture took Pixi's local bounds, which count a node hidden at alpha 0; the faded pill 800 px away
  // grew the picture from 200 to 900 px wide.
  it("leaves out a child hidden at alpha 0", async () => {
    const drawn = await open();
    const panel = drawn.spawn(Transform({ x: 100, y: 100 }), Shape({ w: 200, h: 100 }));

    child(drawn, panel, 800, 0);
    drawn.frame();
    drawn.mock.api.sync.filters.set(panel, [slot()]);
    drawn.frames(4);

    expect(lastPicture(drawn, panel)).toEqual({ width: 200, height: 100 });
  });

  it("takes the child in again once it shows", async () => {
    const drawn = await open();
    const panel = drawn.spawn(Transform({ x: 100, y: 100 }), Shape({ w: 200, h: 100 }));
    const pill = child(drawn, panel, 800, 0);

    drawn.frame();
    drawn.mock.api.sync.filters.set(panel, [slot()]);
    drawn.frames(4);
    drawn.mock.world.ecs.set(pill, Shape, { alpha: 1 });
    drawn.frames(4);

    expect(lastPicture(drawn, panel)).toEqual({ width: 900, height: 100 });
  });
});

describe("a kept picture of a clipping view", () => {
  // Bug: a walk of the drawn nodes that left the mask out would keep the whole list under a clipping panel.
  it("holds the clip box, not the children the mask cuts", async () => {
    const drawn = await open();
    const list = drawn.spawn(Transform({ x: 100, y: 100 }), Shape({ w: 300, h: 150, clip: true }));

    for (const x of [0, 400, 800]) child(drawn, list, x);
    drawn.frame();
    drawn.mock.api.sync.filters.set(list, [slot()]);
    drawn.frames(4);

    expect(lastPicture(drawn, list)).toEqual({ width: 300, height: 150 });
  });
});

describe("a kept picture is cut to the canvas (F53)", () => {
  // Bug F53: the picture took the subtree's whole bounds; the ward's panorama, 3000 px wide, was kept whole, where the
  // live pass keeps the 1080 px on the canvas.
  it("keeps only the part of a wide view on the canvas", async () => {
    const drawn = await open();
    const panorama = drawn.spawn(Transform({ x: -1000, y: 0 }), Shape({ w: 3000, h: 400 }));

    drawn.frame();
    drawn.mock.api.sync.filters.set(panorama, [slot()]);
    drawn.frames(4);

    expect(lastPicture(drawn, panorama)).toEqual({ width: 1080, height: 400 });
  });

  it("takes a cut picture again when the view moves, so the part it left out shows", async () => {
    const drawn = await open();
    const panorama = drawn.spawn(Transform({ x: -1000, y: 0 }), Shape({ w: 3000, h: 400 }));

    drawn.frame();
    drawn.mock.api.sync.filters.set(panorama, [slot()]);
    drawn.frames(4);

    const before = picturesOf(drawn, panorama).length;

    drawn.mock.world.ecs.set(panorama, Transform, { x: -500 });
    drawn.frame();

    expect(picturesOf(drawn, panorama).length).toBe(before + 1);
    expect(drawn.mock.ctx.state.kept.byEntity.get(panorama)?.mode).toBe("kept");
  });

  // Bug F113: a still panorama wider than the canvas under a zoom was taken while the zoom ran; a cut picture is never
  // drawn scaled, so it was taken again in each of the next frames, went calm, and stayed live for eight frames after
  // the zoom (A Memory Missing's ward: kept six frames later than before when a memory opened over it).
  it("takes no cut picture while an ancestor zooms, and takes it two frames after the zoom", async () => {
    const drawn = await open();
    const camera = drawn.spawn(Transform({ x: 0, y: 0 }), Shape({ w: 1, h: 1 }));
    const panorama = drawn.mock.world.ecs.spawn(OWNER, [
      Transform({ x: -1000, y: 0 }),
      Shape({ w: 3000, h: 400 }),
      Parent({ entity: camera })
    ]);

    drawn.frame();
    drawn.mock.api.sync.filters.set(panorama, [slot()]);

    for (let frame = 1; frame <= 8; frame += 1) {
      drawn.mock.world.ecs.set(camera, Transform, { scale: 0.96 + frame * 0.005 });
      drawn.frame();
    }

    expect(picturesOf(drawn, panorama)).toHaveLength(0);

    drawn.frames(3);

    expect(picturesOf(drawn, panorama)).toHaveLength(1);
    expect(drawn.mock.ctx.state.kept.byEntity.get(panorama)?.mode).toBe("kept");
  });

  it("only moves the quad of a picture wholly on the canvas", async () => {
    const drawn = await open();
    const card = drawn.spawn(Transform({ x: 100, y: 100 }), Shape({ w: 200, h: 100 }));

    drawn.frame();
    drawn.mock.api.sync.filters.set(card, [slot()]);
    drawn.frames(4);

    const before = picturesOf(drawn, card).length;

    drawn.mock.world.ecs.set(card, Transform, { x: 300 });
    drawn.frame();

    expect(picturesOf(drawn, card).length).toBe(before);
  });

  it("takes a cut picture again when the canvas grows", async () => {
    const drawn = await open();
    const panorama = drawn.spawn(Transform({ x: 0, y: 0 }), Shape({ w: 3000, h: 400 }));

    drawn.frame();
    drawn.mock.api.sync.filters.set(panorama, [slot()]);
    drawn.frames(4);
    // As the viewport resizes the canvas: the size, and a whole frame drawn.
    drawn.mock.modules.host.resize(1600, 1920);
    drawn.mock.modules.demand.whole("resize");
    drawn.frames(2);

    expect(lastPicture(drawn, panorama)).toEqual({ width: 1600, height: 400 });
  });
});
