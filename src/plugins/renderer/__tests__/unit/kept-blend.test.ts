import * as pixi from "pixi.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Entity } from "../../../world/types";
import { Parent, Shape, Sprite, Transform } from "../../components";
import type { FilterSlot, PixiContainer } from "../../types";
import { type Drawn, OWNER, startDrawn } from "../demand-harness";
import type { RenderCall } from "../stage-pixi";

// ---------------------------------------------------------------------------
// Kept pictures and blends (F68, spec 23 addendum): a node under a filtered view's top that blends otherwise than
// normally would blend with the empty texture of the picture, not with what is drawn under the view, so the view is
// drawn live, never taken or retaken, and warned once. A refusal is remembered until the subtree changes. The whole
// renderer runs over the real Pixi of `stagePixi`, every frame drawn; the tree and the picture oracles check them.
// ---------------------------------------------------------------------------

const running: Drawn[] = [];

/**
 * Starts the renderer with every frame drawn and keeps it for the teardown.
 *
 * @returns The running renderer.
 */
async function open(): Promise<Drawn> {
  const drawn = await startDrawn({ onDemand: false });

  running.push(drawn);

  return drawn;
}

afterEach(() => {
  for (const drawn of running.splice(0)) {
    drawn.oracle.expectNoMissedFrame();
    drawn.oracle.expectPicturesCurrent();
    drawn.mock.stop();
  }

  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/**
 * A slot of a real Pixi filter the cache may keep.
 *
 * @returns The slot.
 */
function slot(): FilterSlot {
  return { filter: new pixi.AlphaFilter(), passes: 1, cache: "local" };
}

/**
 * The top of an entity's view (`wrapper ?? object`).
 *
 * @param drawn - The running renderer.
 * @param entity - The entity.
 * @returns The top.
 */
function topOf(drawn: Drawn, entity: Entity): PixiContainer {
  const view = drawn.mock.ctx.state.sync.views.get(entity);

  if (view === undefined) throw new Error(`no view for ${entity}`);

  return view.wrapper ?? view.object;
}

/**
 * The renders of the first stage of an entity's pictures.
 *
 * @param drawn - The running renderer.
 * @param entity - The entity.
 * @returns The render calls.
 */
function stageOneOf(drawn: Drawn, entity: Entity): RenderCall[] {
  const label = topOf(drawn, entity).label;

  return drawn.stage.targets().filter(call => call.target?.source.label === `kept:${label}#1`);
}

/**
 * The details of every `renderer:kept-blend` warning.
 *
 * @param drawn - The running renderer.
 * @returns The details, in order.
 */
function blendWarnings(drawn: Drawn): unknown[] {
  return vi
    .mocked(drawn.mock.log.warn)
    .mock.calls.filter(([message]) => message === "renderer:kept-blend")
    .map(([, detail]) => detail);
}

/**
 * Spawns a child view of a parent.
 *
 * @param drawn - The running renderer.
 * @param parent - The parent entity.
 * @param visual - The child's visual.
 * @returns The child.
 */
function childOf(drawn: Drawn, parent: Entity, visual: Parameters<Drawn["spawn"]>[0]): Entity {
  return drawn.mock.world.ecs.spawn(OWNER, [
    Parent({ entity: parent }),
    Transform({ x: 20, y: 20 }),
    visual
  ]);
}

/**
 * One frame without the tree oracle, which reads every node's blend: the sync pass, the change sets closed, input and
 * render.
 *
 * @param drawn - The running renderer.
 */
function unwatchedFrame(drawn: Drawn): void {
  drawn.mock.modules.sync.pass();
  drawn.mock.world.clearChanges();
  drawn.mock.runPhase("input");
  drawn.mock.runPhase("render");
}

describe("a filtered view with a blended node inside", () => {
  // Bug: the glow is baked into the picture against nothing and composited normally, so it covers the board under it
  // instead of adding to it; or a glow two levels down is missed; or the warning repeats every frame.
  it("is drawn live, warned once; the walk is not taken again until its subtree changes, then it is kept", async () => {
    const drawn = await open();
    const card = drawn.spawn(Transform({ x: 100, y: 100 }), Shape({ w: 200, h: 200 }));
    const frame = childOf(drawn, card, Shape({ w: 160, h: 160, fill: 0x22_33_44 }));
    const glow = childOf(
      drawn,
      frame,
      Sprite({ texture: "fx.glow", width: 40, height: 40, blend: "add" })
    );

    drawn.frame();
    drawn.mock.api.sync.filters.set(card, [slot()]);
    drawn.frames(6);

    expect(stageOneOf(drawn, card)).toHaveLength(0);
    expect(topOf(drawn, card).renderable).toBe(true);
    expect(blendWarnings(drawn)).toEqual([{ picture: topOf(drawn, card).label }]);

    // While the refusal stands, no frame reads the glow's blend: the walk is remembered.
    const object = drawn.objectOf(glow);

    if (object === undefined) throw new Error("the glow has no view");

    const reads = vi.spyOn(object, "blendMode", "get");

    for (let index = 0; index < 6; index += 1) unwatchedFrame(drawn);

    expect(reads).not.toHaveBeenCalled();
    reads.mockRestore();

    // The glow turned off marks the subtree: the walk is taken again, finds nothing, and the view is kept.
    drawn.mock.world.ecs.set(glow, Sprite, { blend: "normal" });
    drawn.frames(4);

    expect(stageOneOf(drawn, card)).toHaveLength(1);
    expect(topOf(drawn, card).renderable).toBe(false);
    expect(blendWarnings(drawn)).toHaveLength(1);
  });

  // Bug: the walk refuses every view that has children, and a filtered panel is never kept again.
  it("is kept as before when nothing under it blends", async () => {
    const drawn = await open();
    const card = drawn.spawn(Transform({ x: 100, y: 100 }), Shape({ w: 200, h: 200 }));

    childOf(drawn, card, Sprite({ texture: "fx.glow", width: 40, height: 40 }));
    drawn.frame();
    drawn.mock.api.sync.filters.set(card, [slot()]);
    drawn.frames(4);

    expect(stageOneOf(drawn, card)).toHaveLength(1);
    expect(topOf(drawn, card).renderable).toBe(false);
    expect(blendWarnings(drawn)).toEqual([]);
  });

  // Bug: the retake of a kept view whose child turned to a glow bakes the glow against the picture's empty texture.
  it("goes live in the frame a child of a kept view turns to screen, warned once", async () => {
    const drawn = await open();
    const card = drawn.spawn(Transform({ x: 100, y: 100 }), Shape({ w: 200, h: 200 }));
    const glow = childOf(drawn, card, Sprite({ texture: "fx.glow", width: 40, height: 40 }));

    drawn.frame();
    drawn.mock.api.sync.filters.set(card, [slot()]);
    drawn.frames(4);

    expect(topOf(drawn, card).renderable).toBe(false);

    drawn.mock.world.ecs.set(glow, Sprite, { blend: "screen" });
    drawn.frame();

    expect(topOf(drawn, card).renderable).toBe(true);
    expect(drawn.mock.ctx.state.kept.byEntity.get(card)?.mode).toBe("live");

    drawn.frames(6);

    expect(stageOneOf(drawn, card)).toHaveLength(1);
    expect(blendWarnings(drawn)).toEqual([{ picture: topOf(drawn, card).label }]);
  });
});
