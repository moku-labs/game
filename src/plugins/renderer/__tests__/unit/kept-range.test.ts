import * as pixi from "pixi.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Entity } from "../../../world/types";
import { Shape, Transform } from "../../components";
import type { KeptRange } from "../../kept/types";
import { withDeps } from "../../lifecycle";
import { type HiddenCtx, setHidden, setObjectHidden } from "../../sync/hidden";
import type { PixiContainer } from "../../types";
import { type Drawn, startDrawn } from "../demand-harness";
import type { RenderCall } from "../stage-pixi";

// ---------------------------------------------------------------------------
// The range pictures of overlays (spec 23 P7), driven through the seam the way
// spec 22 drives it: `take`, `retake`, `move`, `release`, `kept`, `sprite`. One
// render of the stage root per picture, with only the range drawn; the sprite
// placed before `slot.before`. Spec 22's own tests cover the overlay side.
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

/** The overlay entity the tests' range belongs to. */
const OVERLAY = 9001;

/** A running renderer with three views in its layer: two in the range, one above it. */
type Scene = {
  drawn: Drawn;
  low: Entity;
  mid: Entity;
  top: Entity;
  layer: PixiContainer;
  root: PixiContainer;
  hidden: HiddenCtx;
  /** What spec 22 would hand over; a test may hand over another. */
  range: KeptRange;
  /** The top of an entity's view. */
  topOf(entity: Entity): PixiContainer;
};

/**
 * Starts a scene of three shapes, the lower two hidden by `"freeze"` as spec 22 hides a range, the third above it.
 *
 * @param onDemand - `config.onDemand`; on by default here, the takes ask for their frame.
 * @param keptMb - The budget.
 * @returns The scene.
 */
async function scene(onDemand = true, keptMb = 64): Promise<Scene> {
  const drawn = await startDrawn({ onDemand, config: { keptMb } });

  running.push(drawn);

  const low = drawn.spawn(Transform({ x: 100, y: 100 }), Shape({ w: 40, h: 40 }));
  const mid = drawn.spawn(Transform({ x: 200, y: 100 }), Shape({ w: 40, h: 40 }));
  const top = drawn.spawn(Transform({ x: 300, y: 100 }), Shape({ w: 40, h: 40 }));

  drawn.frames(2);

  const { sync } = drawn.mock.ctx.state;
  const topOf = (entity: Entity): PixiContainer => {
    const view = sync.views.get(entity);

    if (view === undefined) throw new Error(`no view for ${entity}`);

    return view.wrapper ?? view.object;
  };
  const layer = sync.layers.get("items")?.container;
  const root = sync.root;

  if (layer === undefined || root === undefined) throw new Error("no layer");

  const hidden: HiddenCtx = {
    ctx: withDeps(drawn.mock.ctx),
    deps: { demand: drawn.mock.modules.demand }
  };

  return {
    drawn,
    low,
    mid,
    top,
    layer,
    root,
    hidden,
    topOf,
    range: {
      id: OVERLAY,
      entries: [topOf(low), topOf(mid)],
      others: [topOf(top)],
      slot: { container: layer, before: topOf(top) }
    }
  };
}

/**
 * Hides the range's entries by `"freeze"`, takes its picture and draws the frame, as spec 22's overlay step does.
 *
 * @param world - The scene.
 * @returns What `take` answered.
 */
function freeze(world: Scene): boolean {
  const { drawn, hidden } = world;

  for (const entity of [world.low, world.mid]) {
    const view = drawn.mock.ctx.state.sync.views.get(entity);

    if (view !== undefined) setHidden(hidden, entity, view, "freeze", true);
  }

  const taken = drawn.mock.modules.kept.take(world.range);

  drawn.mock.modules.demand.whole("retake");
  drawn.frame();

  return taken;
}

/**
 * The renders of the stage root since a point of the log.
 *
 * @param world - The scene.
 * @param from - The log length to count from.
 * @returns The calls.
 */
function rootRenders(world: Scene, from = 0): RenderCall[] {
  return world.drawn.stage
    .targets()
    .slice(from)
    .filter(call => call.container === world.root);
}

describe("the range pictures of overlays", () => {
  it("take renders the stage root once into one canvas-sized picture before the stage pass, with only the entries drawn", async () => {
    const world = await scene();
    const during: string[] = [];

    world.drawn.stage.last().renderer.watchers.push(call => {
      if (call.container !== world.root) return;

      during.push(
        [world.low, world.mid, world.top]
          .map(entity => (world.topOf(entity).renderable ? "drawn" : "hidden"))
          .join(",")
      );
    });

    expect(freeze(world)).toBe(true);

    const [call] = rootRenders(world);

    expect(rootRenders(world)).toHaveLength(1);
    expect(call?.clear).toBe(true);
    expect(call?.transform).toEqual({ a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 });
    expect(call?.target?.source.width).toBe(1080);
    expect(call?.target?.source.height).toBe(1920);
    expect(during).toEqual(["drawn,drawn,hidden"]);
    // Back from their masks after the render, and no mark made by it.
    expect([world.low, world.mid, world.top].map(entity => world.topOf(entity).renderable)).toEqual(
      [false, false, true]
    );
    expect(world.drawn.mock.modules.demand.marked().size).toBe(0);
  });

  it("only the stage root becomes a render group; no entry does", async () => {
    const world = await scene();

    freeze(world);

    expect(world.root.isRenderGroup).toBe(true);
    expect(world.layer.isRenderGroup).toBe(false);
    expect(world.range.entries.map(entry => entry.isRenderGroup)).toEqual([false, false]);
  });

  it("the sprite stands immediately before slot.before in slot.container and covers the canvas in its space", async () => {
    const world = await scene();

    freeze(world);

    const sprite = world.drawn.mock.modules.kept.sprite(OVERLAY);
    const before = world.topOf(world.top);

    expect(sprite?.parent).toBe(world.layer);
    expect(world.layer.children[world.layer.getChildIndex(before) - 1]).toBe(sprite);
    expect(sprite?.getGlobalTransform(undefined, false)).toMatchObject({
      a: 1,
      b: 0,
      c: 0,
      d: 1,
      tx: 0,
      ty: 0
    });
    expect(world.drawn.mock.modules.kept.kept(OVERLAY)).toBe(true);
  });

  it("an entry hidden by cover as well stays out of the picture; one hidden only by freeze is in it", async () => {
    const world = await scene();
    const view = world.drawn.mock.ctx.state.sync.views.get(world.mid);
    const during: boolean[] = [];

    if (view !== undefined) setHidden(world.hidden, world.mid, view, "cover", true);
    world.drawn.stage.last().renderer.watchers.push(call => {
      if (call.container === world.root) {
        during.push(world.topOf(world.low).renderable, world.topOf(world.mid).renderable);
      }
    });
    freeze(world);

    expect(during).toEqual([true, false]);
  });

  it("retake renders again in this frame's flush; a frame not drawn flushes nothing", async () => {
    const world = await scene();

    freeze(world);

    const from = world.drawn.stage.targets().length;

    world.drawn.mock.modules.kept.retake(OVERLAY);

    expect(world.drawn.frame()).toBe(false);
    expect(rootRenders(world, from)).toHaveLength(0);

    world.drawn.mock.modules.demand.whole("retake");

    expect(world.drawn.frame()).toBe(true);
    expect(rootRenders(world, from)).toHaveLength(1);
  });

  it("move places the sprite again in the same frame; a sprite pushed out of place is put back by the next flush", async () => {
    const world = await scene();

    freeze(world);

    const kept = world.drawn.mock.modules.kept;
    const sprite = kept.sprite(OVERLAY);
    const before = world.topOf(world.mid);

    kept.move(OVERLAY, { container: world.layer, before });

    expect(world.layer.children[world.layer.getChildIndex(before) - 1]).toBe(sprite);

    sprite?.removeFromParent();
    world.root.addChild(sprite as PixiContainer);
    world.drawn.mock.modules.demand.whole("overlay");
    world.drawn.frame();

    expect(sprite?.parent).toBe(world.layer);
    expect(world.layer.children[world.layer.getChildIndex(before) - 1]).toBe(sprite);
  });

  it("release takes the sprite out in that frame and leaves its texture as the spare, which the next take reuses", async () => {
    const world = await scene();

    freeze(world);

    const kept = world.drawn.mock.modules.kept;
    const sprite = kept.sprite(OVERLAY);
    const picture = rootRenders(world)[0]?.target;

    kept.release(OVERLAY);

    expect(sprite?.destroyed).toBe(true);
    expect(sprite?.parent).toBeNull();
    expect(world.drawn.mock.ctx.state.kept.spare).toBe(picture);
    expect(kept.kept(OVERLAY)).toBe(false);

    const from = world.drawn.stage.targets().length;

    kept.take(world.range);
    world.drawn.mock.modules.demand.whole("retake");
    world.drawn.frame();

    expect(rootRenders(world, from)[0]?.target).toBe(picture);
    expect(world.drawn.mock.ctx.state.kept.spare).toBeUndefined();
  });

  it("a take of an id that holds a picture is a retake with the new entries and others", async () => {
    const world = await scene();

    freeze(world);

    const from = world.drawn.stage.targets().length;
    const during: boolean[] = [];

    world.drawn.stage.last().renderer.watchers.push(call => {
      if (call.container === world.root) during.push(world.topOf(world.mid).renderable);
    });

    expect(
      world.drawn.mock.modules.kept.take({
        ...world.range,
        entries: [world.topOf(world.low)],
        others: [world.topOf(world.mid), world.topOf(world.top)]
      })
    ).toBe(true);
    world.drawn.mock.modules.demand.whole("retake");
    world.drawn.frame();

    expect(rootRenders(world, from)).toHaveLength(1);
    expect(during).toEqual([false]);
  });

  it("take answers false and places nothing with the switch off, on a lost device, and over the budget", async () => {
    const off = await scene();

    off.drawn.mock.api.sync.debug.kept(false);

    expect(off.drawn.mock.modules.kept.take(off.range)).toBe(false);

    const lost = await scene();

    lost.drawn.mock.ctx.state.host.ready = false;

    expect(lost.drawn.mock.modules.kept.take(lost.range)).toBe(false);

    lost.drawn.mock.ctx.state.host.ready = true;

    const full = await scene(true, 1);

    expect(full.drawn.mock.modules.kept.take(full.range)).toBe(false);

    for (const world of [off, lost, full]) {
      expect(world.drawn.mock.modules.kept.sprite(OVERLAY)).toBeUndefined();
      expect(world.layer.children.some(child => child.label === `freeze:${OVERLAY}`)).toBe(false);
    }
  });

  it("sprite(id) answers the sprite, kept(id) whether a picture is held; unknown ids are no-ops", async () => {
    const world = await scene();
    const kept = world.drawn.mock.modules.kept;

    freeze(world);

    expect(kept.sprite(OVERLAY)?.label).toBe(`freeze:${OVERLAY}`);
    expect(kept.kept(OVERLAY)).toBe(true);
    expect(kept.kept(42)).toBe(false);
    expect(kept.sprite(42)).toBeUndefined();
    expect(() => {
      kept.retake(42);
      kept.move(42, world.range.slot);
      kept.release(42);
    }).not.toThrow();
  });

  it("a cached view inside an entry is drawn into the range picture through its current quad", async () => {
    const world = await scene(false);
    const quads: string[] = [];

    world.drawn.mock.api.sync.filters.set(world.low, [
      { filter: new pixi.AlphaFilter(), passes: 1, cache: "local" }
    ]);
    world.drawn.frames(3);
    world.drawn.stage.last().renderer.watchers.push(call => {
      if (call.container !== world.root) return;

      const top = world.topOf(world.low);
      const quad = top.parent?.children.find(child => child.label === `kept:${top.label}`);

      quads.push(`${top.renderable}:${quad?.visible === true}`);
    });
    // A quad that hangs in a layer container is an entry like any engine object (OQ23-8): spec 22 hides and lifts it.
    const top = world.topOf(world.low);
    const quad = top.parent?.children.find(child => child.label === `kept:${top.label}`);

    if (quad === undefined) throw new Error("the cached view has no quad");

    setObjectHidden(world.hidden, quad, "freeze", true);
    world.range = { ...world.range, entries: [top, quad, world.topOf(world.mid)] };
    // Its picture is retaken in this frame's flush before the range picture draws its quad.
    freeze(world);

    expect(quads).toEqual(["false:true"]);
    expect(quad.renderable).toBe(false);
  });

  it("a resize retake resizes the picture to the new canvas first", async () => {
    const world = await scene();

    freeze(world);

    const from = world.drawn.stage.targets().length;

    world.drawn.stage.last().screen.width = 500;
    world.drawn.mock.modules.kept.retake(OVERLAY);
    world.drawn.mock.modules.demand.whole("retake");
    world.drawn.frame();

    expect(rootRenders(world, from)[0]?.target?.source.width).toBe(500);
  });
});
