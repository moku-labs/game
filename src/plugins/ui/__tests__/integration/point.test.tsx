import { afterEach, describe, expect, it, vi } from "vitest";
import { Shape, Sprite } from "../../../renderer/components";
import { Box } from "../../components";
import {
  DOT,
  entityOf,
  frames,
  glides,
  type PointApp,
  press,
  SLAB,
  startPointApp,
  tapAt
} from "../point-app";

// ---------------------------------------------------------------------------
// Integration: a target of no area (F101) and an image laid out at no size
// (F102). An `<anchor>` on a point stands there at size 0, shown, and its
// children overflow it and take presses; an image of no width or no height
// draws nothing and takes no tap. Drawn on the fake page and the fake Pixi, so
// a press goes through the renderer's hit test. Real flow, world, Yoga.
// ---------------------------------------------------------------------------

/** The anchor on the dot or the slab. */
const MARKER = { projection: "point.screen", key: "marker" };

/** The 40 u button inside the marker. */
const HAND = { projection: "point.screen", key: "hand" };

/** The anchor on the slab padded inward by 60. */
const SQUEEZED = { projection: "point.screen", key: "squeezed" };

/** The image whose size the controls set. */
const PICTURE = { projection: "point.screen", key: "picture" };

/** The image whose style states no size. */
const PLACED = { projection: "point.screen", key: "placed" };

/** The app of the running test, stopped after it. */
let running: PointApp | undefined;

afterEach(async () => {
  await running?.stop();
  running = undefined;
  vi.unstubAllGlobals();
});

/**
 * Starts the fixture with the board and the screen mounted.
 *
 * @returns The app and its fake Pixi.
 */
async function started() {
  const app = await startPointApp();

  running = app.app;

  return app;
}

/**
 * Runs frames until the 300 ms glide of the marker is over.
 *
 * @param app - The running app.
 */
function settle(app: PointApp): void {
  frames(app, 25);
}

/**
 * The outcomes of the edges the graph took, in order.
 *
 * @param app - The running app.
 * @returns The outcome names.
 */
function outcomes(app: PointApp): string[] {
  return app.flow.history().map(entry => entry.outcome);
}

describe("an anchor on a target of no area", () => {
  it("stands at the point, shown, at size 0, as rectOf says", async () => {
    // Bug caught: a target of no area counts as not shown, so an anchor on a point never shows
    // and `rectOf` answers undefined.
    const { app } = await started();
    const point = { x: 300, y: 400, w: 0, h: 0 };

    expect(app.ui.rectOf(DOT)).toEqual(point);
    expect(app.ui.rectOf(MARKER)).toEqual(point);
    expect(app.world.ecs.get(entityOf(app, MARKER), Box)).toEqual(point);
    expect(app.world.ecs.get(entityOf(app, MARKER), Shape)?.alpha).toBe(1);
  });

  it("lays out a child that overflows it, which takes the press, while the anchor takes none", async () => {
    // Bug caught: the children of a zero-size anchor are squeezed to nothing or hidden with it, so
    // a marker on a point cannot be tapped; or the anchor's own view takes the press.
    const { app, pixi } = await started();
    const under = app.renderer.sync.hitAll(300, 400);

    expect(app.ui.rectOf(HAND)).toEqual({ x: 300, y: 400, w: 40, h: 40 });
    expect(under).toContain(entityOf(app, HAND));
    expect(under).not.toContain(entityOf(app, MARKER));

    await tapAt(app, pixi, { x: 320, y: 420 });

    expect(outcomes(app)).toEqual(["hand"]);
  });

  it("glides with its change.Box motion from the point to a rect and back", async () => {
    // Bug caught: an anchor first shown on a rect after a point jumps there with no motion, or a
    // rect shrinking to a point hides the anchor instead of gliding it.
    const { app } = await started();

    press(app, "go-slab");

    expect(glides.box).toBe(1);

    settle(app);

    expect(app.ui.rectOf(MARKER)).toEqual({ x: 600, y: 400, w: 100, h: 60 });

    press(app, "go-dot");

    expect(glides.box).toBe(2);

    settle(app);

    expect(app.ui.rectOf(MARKER)).toEqual({ x: 300, y: 400, w: 0, h: 0 });
    expect(app.world.ecs.get(entityOf(app, MARKER), Shape)?.alpha).toBe(1);
  });

  it("clamps an inward pad beyond half the target to size 0 at its centre, shown", async () => {
    // Bug caught: a pad that turns the size negative hides the anchor, or the clamp keeps the
    // padded corner, so the anchor leaves the middle of its target.
    const { app } = await started();
    const squeezed = entityOf(app, SQUEEZED);

    expect(app.ui.rectOf(SLAB)).toEqual({ x: 600, y: 400, w: 100, h: 60 });
    expect(app.world.ecs.get(squeezed, Box)).toEqual({ x: 650, y: 430, w: 0, h: 0 });
    expect(app.world.ecs.get(squeezed, Shape)?.alpha).toBe(1);
  });
});

describe("an image laid out at no size", () => {
  it("draws nothing and takes no tap at width 0 or height 0, and draws at its size again", async () => {
    // Bug caught: the renderer draws a sprite of width 0 at its texture's size, so an image laid
    // out at no size shows the whole texture, takes presses and counts as a point for an anchor.
    const { app } = await started();
    const picture = entityOf(app, PICTURE);
    const sprite = () => app.world.ecs.get(picture, Sprite);
    const hit = (): boolean => app.renderer.sync.hitAll(110, 1010).includes(picture);

    expect(sprite()).toMatchObject({ alpha: 1, width: 40, height: 40 });
    expect(hit()).toBe(true);

    press(app, "go-thin");

    expect(sprite()).toMatchObject({ alpha: 0, width: 0, height: 40 });
    expect(hit()).toBe(false);
    expect(app.ui.rectOf(PICTURE)).toBeUndefined();

    press(app, "go-flat");

    expect(sprite()).toMatchObject({ alpha: 0, width: 40, height: 0 });
    expect(hit()).toBe(false);

    press(app, "go-none");

    expect(sprite()).toMatchObject({ alpha: 0, width: 0, height: 0 });
    expect(hit()).toBe(false);

    press(app, "go-full");

    expect(sprite()).toMatchObject({ alpha: 1, width: 40, height: 40 });
    expect(hit()).toBe(true);
  });

  it("keeps its alpha when its style states no size, and draws at the size a system writes (F111)", async () => {
    // Bug caught: an image the layout leaves at 0 by 0 because its style states no size, whose
    // sprite a game's own system sizes (a backdrop that covers the screen), is put at alpha 0: the
    // backdrop vanishes and its blurred picture is never kept.
    const { app } = await started();
    const placed = entityOf(app, PLACED);

    expect(app.world.ecs.get(placed, Box)).toMatchObject({ w: 0, h: 0 });
    expect(app.world.ecs.get(placed, Sprite)?.alpha).toBe(1);

    app.world.ecs.set(placed, Sprite, { width: 50, height: 50 });
    frames(app, 1);

    expect(app.world.ecs.get(placed, Sprite)).toMatchObject({ alpha: 1, width: 50, height: 50 });
    expect(app.renderer.sync.hitAll(320, 1020)).toContain(placed);
  });
});
