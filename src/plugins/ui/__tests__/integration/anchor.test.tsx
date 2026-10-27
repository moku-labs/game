import { afterEach, describe, expect, it, vi } from "vitest";
import { read } from "../../../flow/doors/read";
import { NineSlice, Shape, Sprite, Transform } from "../../../renderer/components";
import { Box, UiCounters } from "../../components";
import { locateSource } from "../../inspect";
import {
  type AnchorApp,
  CELL,
  entityOf,
  frames,
  glides,
  logged,
  loops,
  mount,
  NOWHERE,
  PIECE,
  press,
  SEAT0,
  startAnchorApp
} from "../anchor-app";

// ---------------------------------------------------------------------------
// Integration: `<anchor>` and `app.ui.rectOf` (F99). The window of the
// tutorial sits on an element of the board's projection, in the frame it is
// laid out, through scrolls, fits and world views; it hides while nothing it
// names is shown, and its `change.Box` motion plays only for a new target.
// Real world, real Yoga, plain Bun, inert renderer.
// ---------------------------------------------------------------------------

/** The window of the tutorial. */
const WINDOW = { projection: "tutorial", key: "window" };

/** The window inside the container drawn at half its size. */
const HALF_WINDOW = { projection: "tutorial", key: "halfWindow" };

/** The rim that fills the window. */
const RIM = { projection: "tutorial", key: "rim" };

/** A mark placed absolutely in the window's corner: it only ever moves with the window. */
const MARK = { projection: "tutorial", key: "mark" };

/** The note the window holds once its rim is thin. */
const NOTE = { projection: "tutorial", key: "note" };

/** The window that is the root element of its screen. */
const ROOT_WINDOW = { projection: "rootAnchor", key: "rootWindow" };

/** The anchor whose style sets a size and a place, drawn with a nine-slice. */
const STYLED = { projection: "styled", key: "styledWindow" };

/** The app of the running test, stopped after it. */
let running: AnchorApp | undefined;

afterEach(async () => {
  vi.unstubAllGlobals();
  await running?.stop();
  running = undefined;
});

/**
 * Starts the fixture with the board, the piece and the tutorial mounted, after `count` frames.
 *
 * @param count - The frames to run after the mount.
 * @returns The app.
 */
async function mounted(count = 2): Promise<AnchorApp> {
  running = await startAnchorApp();
  mount(running, ["board.strip", "board.pieces", "tutorial"]);
  frames(running, count);

  return running;
}

/**
 * Runs frames until the 300 ms glide of the window is over.
 *
 * @param app - The running app.
 */
function settle(app: AnchorApp): void {
  frames(app, 25);
}

/**
 * The alpha the window is drawn at.
 *
 * @param app - The running app.
 * @returns The alpha of its `Shape`.
 */
function windowAlpha(app: AnchorApp): number | undefined {
  return app.world.ecs.get(entityOf(app, WINDOW), Shape)?.alpha;
}

describe("an anchor on an element of another projection", () => {
  it("sits where the element is drawn in the frame both are mounted, as rectOf and locate say", async () => {
    // Bug caught: the window is placed a frame late, or off the element (a mapping that misses
    // the scroll and the root of the other projection).
    const app = await mounted(1);
    const seat = app.ui.rectOf(SEAT0);
    const located = read(app, locateSource, { key: "seat0" });
    const topLeft = app.renderer.viewport.toReference(located?.x ?? 0, located?.y ?? 0);
    const bottomRight = app.renderer.viewport.toReference(
      (located?.x ?? 0) + (located?.w ?? 0),
      (located?.y ?? 0) + (located?.h ?? 0)
    );

    expect(seat).toEqual({ x: 40, y: 1500, w: 116, h: 120 });
    expect(app.ui.rectOf(WINDOW)).toEqual(seat);
    expect(app.world.ecs.get(entityOf(app, WINDOW), Box)).toEqual(seat);
    expect(topLeft.x).toBeCloseTo(40, 2);
    expect(topLeft.y).toBeCloseTo(1500, 2);
    expect(bottomRight.x - topLeft.x).toBeCloseTo(116, 2);
    expect(bottomRight.y - topLeft.y).toBeCloseTo(120, 2);
    // Its children lay out inside it: the rim fills it.
    expect(app.ui.rectOf(RIM)).toEqual(seat);
  });

  it("maps through a fitted parent and pads in the units of its root", async () => {
    // Bug caught: the parent's fit is skipped, or `pad` is added in screen units: drawn at half
    // size, a pad of 4 is 2 on the screen.
    const app = await mounted();

    expect(app.ui.rectOf(HALF_WINDOW)).toEqual({ x: 38, y: 1498, w: 120, h: 124 });
    expect(app.world.ecs.get(entityOf(app, HALF_WINDOW), Box)?.w).toBe(240);
  });

  it("pads its own window outward on every side", async () => {
    // Bug caught: `pad` grows the rect to the right and down only, or is ignored.
    const app = await mounted();

    press(app, "go-pad");

    expect(app.ui.rectOf(WINDOW)).toEqual({ x: 36, y: 1496, w: 124, h: 128 });
    expect(app.ui.rectOf(RIM)).toEqual({ x: 36, y: 1496, w: 124, h: 128 });
    expect(glides.box).toBe(0);
  });
});

describe("the style of an anchor", () => {
  it("gives its look, never its size or place, and a dev build names it once", async () => {
    // Bug caught: a `width` or `left` in the anchor's style moves it off its target, or the
    // ignored fields go unnamed so the author keeps writing them.
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    running = await startAnchorApp();
    const app = running;

    mount(app, ["board.strip", "styled"]);
    frames(app, 4);

    expect(app.ui.rectOf({ projection: "styled", key: "styledWindow" })).toEqual({
      x: 40,
      y: 1500,
      w: 116,
      h: 120
    });
    expect(app.ui.rectOf({ projection: "styled", key: "styledRim" })).toEqual({
      x: 40,
      y: 1500,
      w: 116,
      h: 120
    });
    expect(logged(app, "ui:anchor-style")).toEqual([{ key: "styledWindow" }]);

    // A square of 400 u fitted inside it is drawn at the anchor's width, centred.
    const fitted = app.ui.rectOf({ projection: "styled", key: "styledFit" });

    expect(fitted?.x).toBeCloseTo(40, 6);
    expect(fitted?.y).toBeCloseTo(1502, 6);
    expect(fitted?.w).toBeCloseTo(116, 6);
    expect(fitted?.h).toBeCloseTo(116, 6);
  });

  it("hides the nine-slice it is drawn with while its target is gone", async () => {
    // Bug caught: only a rectangle is faded, so a framed anchor stays drawn over nothing.
    running = await startAnchorApp();
    const app = running;

    mount(app, ["board.strip", "styled"]);
    frames(app, 2);

    const styled = entityOf(app, STYLED);

    expect(app.world.ecs.get(styled, NineSlice)?.alpha).toBe(1);

    app.world.projection.unmount(["board.strip"]);
    frames(app, 2);

    expect(app.world.ecs.get(styled, NineSlice)?.alpha).toBe(0);
  });
});

describe("an anchor that follows its target", () => {
  it("follows a target the scroll moves, in the same frame and with no motion", async () => {
    // Bug caught: the window reads the target before the scroll step moved it (a frame late), or
    // a follow starts the glide of a new target.
    const app = await mounted();

    expect(app.ui.scroll("strip", 30)).toBe(true);
    frames(app, 1);

    expect(app.ui.rectOf(SEAT0)).toEqual({ x: 10, y: 1500, w: 116, h: 120 });
    expect(app.ui.rectOf(WINDOW)).toEqual({ x: 10, y: 1500, w: 116, h: 120 });
    expect(app.world.ecs.get(entityOf(app, WINDOW), Transform)?.x).toBe(68);
    expect(glides.box).toBe(0);

    // The frame it stands, the `Box` of the window and of its rim take the rects it moved to.
    frames(app, 1);

    expect(app.world.ecs.get(entityOf(app, WINDOW), Box)).toEqual({
      x: 10,
      y: 1500,
      w: 116,
      h: 120
    });
    expect(app.world.ecs.get(entityOf(app, RIM), Box)).toEqual({ x: 10, y: 1500, w: 116, h: 120 });
  });

  it("follows a world view moved by a fraction of a unit, in the same frame", async () => {
    // Bug caught: a world view's own pose is not read, or the window rounds its place.
    const app = await mounted();

    press(app, "go-piece");
    settle(app);
    app.world.ecs.set(entityOf(app, PIECE), Transform, { x: 512.5, y: 700.25 });
    frames(app, 1);

    const window = app.ui.rectOf(WINDOW);

    expect(window?.x).toBeCloseTo(480.5, 6);
    expect(window?.y).toBeCloseTo(668.25, 6);
    expect(window?.w).toBeCloseTo(64, 6);
    expect(glides.box).toBe(1);
  });

  it("lays its subtree out again only when its size changes", async () => {
    // Bug caught: Yoga runs on every frame of a follow, or never again after the first one, so
    // the rim keeps the old size.
    const app = await mounted();
    const counters = app.world.ecs.resource(UiCounters);
    const piece = entityOf(app, PIECE);

    press(app, "go-piece");
    settle(app);

    const before = counters.solves;

    app.world.ecs.set(piece, Transform, { x: 520.5 });
    frames(app, 2);

    expect(counters.solves).toBe(before);

    app.world.ecs.set(piece, Sprite, { width: 80, height: 80 });
    frames(app, 2);

    expect(counters.solves).toBe(before + 1);
    expect(app.ui.rectOf(WINDOW)).toEqual({ x: 480.5, y: 660, w: 80, h: 80 });
    expect(app.ui.rectOf(RIM)).toEqual({ x: 480.5, y: 660, w: 80, h: 80 });
  });
});

describe("the subtree of an anchor", () => {
  it("is laid out again when a child's style changes, the anchor standing", async () => {
    // Bug caught: the anchor's own Yoga tree runs only when its size changes, so a child restyled
    // by a render keeps its old rect.
    const app = await mounted();

    press(app, "go-thin");

    expect(app.ui.rectOf(RIM)).toEqual({ x: 40, y: 1500, w: 116, h: 60 });
    expect(app.ui.rectOf(WINDOW)).toEqual({ x: 40, y: 1500, w: 116, h: 120 });
    // A child the render added under the placed anchor comes with its components and its rect.
    expect(app.world.ecs.get(entityOf(app, NOTE), Box)).toEqual({ x: 40, y: 1580, w: 30, h: 10 });
  });

  it("carries a child along when the anchor moves in a frame a root was solved", async () => {
    // Bug caught: in a frame both a solve and a follow happen, a child only carried along keeps the
    // `Box` of where the anchor was.
    const app = await mounted();

    expect(app.ui.scroll("strip", 30)).toBe(true);
    press(app, "go-thin");

    expect(app.world.ecs.get(entityOf(app, MARK), Box)).toEqual({ x: 10, y: 1500, w: 10, h: 10 });
    expect(app.ui.rectOf(RIM)).toEqual({ x: 10, y: 1500, w: 116, h: 60 });
  });
});

describe("an anchor on several targets", () => {
  it("spans the shown targets of a list and leaves the missing ones out", async () => {
    // Bug caught: the list takes its first target only, or a missing key collapses the union.
    const app = await mounted();

    press(app, "go-list");
    settle(app);

    expect(app.ui.rectOf(WINDOW)).toEqual({ x: 40, y: 250, w: 680, h: 1370 });
    expect(app.ui.rectOf([SEAT0, CELL])).toEqual({ x: 40, y: 250, w: 680, h: 1370 });
    expect(app.ui.rectOf(NOWHERE)).toBeUndefined();

    press(app, "go-listMissing");
    settle(app);

    expect(app.ui.rectOf(WINDOW)).toEqual(app.ui.rectOf(CELL));
    expect(app.ui.rectOf(CELL)).toEqual({ x: 650, y: 250, w: 70, h: 70 });
  });
});

describe("an anchor whose target is not shown", () => {
  it("is not drawn, stays, and shows again when the target does", async () => {
    // Bug caught: the window stays drawn over nothing, is despawned, or never comes back.
    const app = await mounted();
    const window = entityOf(app, WINDOW);

    press(app, "go-missing");
    frames(app, 1);

    expect(windowAlpha(app)).toBe(0);
    expect(app.ui.rectOf(WINDOW)).toBeUndefined();
    expect(entityOf(app, WINDOW)).toBe(window);

    press(app, "go-seat");
    settle(app);

    expect(windowAlpha(app)).toBe(1);
    expect(app.ui.rectOf(WINDOW)).toEqual(app.ui.rectOf(SEAT0));
  });

  it("warns once in a dev build, after a key named nothing two frames in a row", async () => {
    // Bug caught: a target spawned in this frame (its key is found a frame later) warns, or the
    // warning repeats every frame.
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const app = await mounted();

    press(app, "go-missing");

    expect(logged(app, "ui:anchor-target-missing")).toEqual([]);

    frames(app, 5);

    expect(logged(app, "ui:anchor-target-missing")).toEqual([
      { key: "window", to: { projection: "board.strip", key: "nowhere" } }
    ]);
  });

  it("refuses a target inside the anchor itself, once, and is not drawn", async () => {
    // Bug caught: the window sizes itself by its own child, a loop that grows or jumps each frame.
    const app = await mounted();

    press(app, "go-own");
    frames(app, 3);

    expect(windowAlpha(app)).toBe(0);
    expect(logged(app, "ui:anchor-own-child")).toEqual([
      {
        key: "window",
        target: "inner",
        error: expect.objectContaining({
          message:
            '[game] An anchor cannot point at its own child "inner".\n  Point it at an element outside the anchor.'
        })
      }
    ]);
  });

  it("waits with no components until a target is first shown, then sits on it that frame", async () => {
    // Bug caught: a window placed at a zero rect over nothing, or one frame late once its target comes.
    running = await startAnchorApp();
    const app = running;

    mount(app, ["tutorial"]);
    frames(app, 2);

    expect(app.world.ecs.get(entityOf(app, WINDOW), Box)).toBeUndefined();
    expect(app.ui.rectOf(WINDOW)).toBeUndefined();

    mount(app, ["board.strip"]);
    frames(app, 1);

    expect(app.ui.rectOf(WINDOW)).toEqual({ x: 40, y: 1500, w: 116, h: 120 });
    expect(glides.box).toBe(0);
  });
});

describe("an anchor whose target fades or which is a root", () => {
  it("is not drawn while its target is drawn at alpha 0, and shows again with it", async () => {
    // Bug caught: the window sits over a view the player cannot see.
    const app = await mounted();
    const piece = entityOf(app, PIECE);

    press(app, "go-piece");
    settle(app);
    app.world.ecs.set(piece, Sprite, { alpha: 0 });
    frames(app, 1);

    expect(windowAlpha(app)).toBe(0);

    app.world.ecs.set(piece, Sprite, { alpha: 1 });
    frames(app, 1);

    expect(windowAlpha(app)).toBe(1);
    expect(app.ui.rectOf(WINDOW)).toEqual({ x: 468, y: 668, w: 64, h: 64 });
  });

  it("sits on its target as the root of a screen and follows it under a loop", async () => {
    // Bug caught: a root anchor has no parent to map through, or a loop that never ends holds its
    // pose back forever as a motion it waits for.
    running = await startAnchorApp();
    const app = running;

    mount(app, ["board.strip", "rootAnchor"]);
    frames(app, 2);

    expect(app.ui.rectOf(ROOT_WINDOW)).toEqual({ x: 40, y: 1500, w: 116, h: 120 });
    expect(loops.started).toBe(1);

    expect(app.ui.scroll("strip", 30)).toBe(true);
    frames(app, 1);

    expect(app.ui.rectOf(ROOT_WINDOW)).toEqual({ x: 10, y: 1500, w: 116, h: 120 });
  });

  it("waits while its screen is built aside and sits on its target in the swap frame", async () => {
    // Bug caught: an anchor of a scene not shown yet is placed on the live targets, or never placed
    // after the swap.
    running = await startAnchorApp();
    const app = running;
    const owner = { kind: "plugin", name: "test" } as const;
    const layers = app.world.projection.layers();

    mount(app, ["board.strip"]);
    frames(app, 2);

    expect(app.world.projection.build(["board.strip", "tutorial"], owner, layers, 4)).toBe(true);
    frames(app, 3);

    expect(app.world.ecs.get(entityOf(app, WINDOW), Box)).toBeUndefined();

    app.world.projection.setLayers(layers);
    app.world.projection.commit();
    frames(app, 1);

    expect(app.ui.rectOf(WINDOW)).toEqual({ x: 40, y: 1500, w: 116, h: 120 });
  });
});

describe("the motion of an anchor", () => {
  it("glides with its change.Box motion only when its targets change", async () => {
    // Bug caught: the glide plays on every follow, or a new target jumps there with no motion.
    const app = await mounted();
    const window = entityOf(app, WINDOW);

    expect(glides.box).toBe(0);

    press(app, "go-cell");

    expect(glides.box).toBe(1);

    frames(app, 1);

    const between = app.world.ecs.get(window, Transform)?.x ?? 0;

    expect(between).toBeGreaterThan(98);
    expect(between).toBeLessThan(685);

    settle(app);

    expect(app.ui.rectOf(WINDOW)).toEqual({ x: 650, y: 250, w: 70, h: 70 });

    press(app, "go-cell");
    settle(app);

    expect(glides.box).toBe(1);
  });

  it("carries a glide that runs when its target moves, and lands on the target", async () => {
    // Bug caught: a follow during the glide snaps the window onto the target and cuts the glide, or
    // the glide lands where the target was when it began.
    const app = await mounted();
    const window = entityOf(app, WINDOW);

    press(app, "go-piece");
    frames(app, 3);

    const before = app.world.ecs.get(window, Transform)?.x ?? 0;

    app.world.ecs.set(entityOf(app, PIECE), Transform, { x: 600 });
    frames(app, 1);

    const carried = app.world.ecs.get(window, Transform)?.x ?? 0;

    // Moved on by the glide and by the target's 100 u, still short of the target's 600.
    expect(carried).toBeGreaterThan(before + 100);
    expect(carried).toBeLessThan(600);

    settle(app);

    expect(app.ui.rectOf(WINDOW)).toEqual({ x: 568, y: 668, w: 64, h: 64 });
    expect(glides.box).toBe(1);
  });

  it("glides again when the key names another entity elsewhere", async () => {
    // Bug caught: a view spawned again under the same key is taken for the old one moving, so the
    // window jumps to it with no motion.
    const app = await mounted();

    press(app, "go-piece");
    settle(app);
    app.world.ecs.set(entityOf(app, PIECE), Transform, { x: 600 });
    frames(app, 1);

    expect(glides.box).toBe(1);

    app.world.projection.unmount(["board.pieces"]);
    frames(app, 3);
    app.world.projection.mount(["board.pieces"], { kind: "plugin", name: "test" });
    frames(app, 1);

    expect(glides.box).toBe(2);

    settle(app);

    expect(app.ui.rectOf(WINDOW)).toEqual({ x: 468, y: 668, w: 64, h: 64 });
  });
});
