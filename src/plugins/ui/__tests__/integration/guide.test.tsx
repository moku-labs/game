import { afterEach, describe, expect, it, vi } from "vitest";
import { guide } from "../../../../index";
import { Shape, Sprite, Transform } from "../../../renderer/components";
import { Order } from "../../../world/ecs/define";
import { ScrollState } from "../../components";
import { mountScreen, startFieldApp } from "../field-app";
import {
  createGuideApp,
  dragAt,
  entityOf,
  frames,
  type GuideApp,
  type GuideStep,
  logged,
  PIECE,
  settleGuideApp,
  startGuideApp,
  tapAt,
  tick
} from "../guide-app";

// ---------------------------------------------------------------------------
// Integration: the veil and the input lock of a guide (F98). The rest node of
// the fixture derives its guide from `session.step`; `ui` draws the veil around
// the window over its targets every frame and hands `input` the window as its
// lock. Headless for the veil (inert renderer); drawn on the fake page and the
// fake Pixi for the lock, where a press is a pointer event that goes through
// input's hit test. Real flow, world, Yoga.
// ---------------------------------------------------------------------------

/** The rects of the veil: every shape `ui` draws at the order of a guide. */
type VeilRect = { x: number; y: number; w: number; h: number; fill: number; alpha: number };

/** The app of the running test, stopped after it. */
let running: GuideApp | undefined;

afterEach(async () => {
  vi.restoreAllMocks();
  await running?.stop();
  running = undefined;
  vi.unstubAllGlobals();
});

/**
 * Starts the fixture at a step, headless, and records every lock window `ui` hands `input`.
 *
 * @param step - The step the session starts at.
 * @param next - The step the first seat leads to.
 * @returns The app and the lock windows, in order.
 */
async function headless(step: GuideStep, next: GuideStep = "none") {
  const locks: unknown[] = [];
  const { app } = createGuideApp({ step, next });
  const lock = vi.spyOn(app.input.lock, "window");

  lock.mockImplementation(rect => {
    locks.push(rect === undefined || rect === null ? rect : { ...rect });
  });
  running = app;
  await app.start();
  await settleGuideApp(app);

  return { app, locks, lock };
}

/**
 * The rectangles of the veil, sorted top to bottom, left to right.
 *
 * @param app - The running app.
 * @returns Each rectangle with its fill and alpha.
 */
function veil(app: GuideApp): VeilRect[] {
  return [...app.world.ecs.query(Shape, Transform, Order)]
    .filter(row => row[3].value === 1_000_000)
    .map(([, shape, pose]) => ({
      x: pose.x,
      y: pose.y,
      w: shape.w,
      h: shape.h,
      fill: shape.fill,
      alpha: shape.alpha
    }))
    .toSorted((first, second) => first.y - second.y || first.x - second.x);
}

/**
 * The four rects of a veil around a window on the app's screen, sorted as `veil` sorts them.
 *
 * @param app - The running app: its viewport is the screen.
 * @param window - The window.
 * @param window.x - Its left.
 * @param window.y - Its top.
 * @param window.w - Its width.
 * @param window.h - Its height.
 * @returns The rects without fill and alpha.
 */
function around(app: GuideApp, window: { x: number; y: number; w: number; h: number }) {
  const { width, height } = app.renderer.viewport.size();

  return [
    { x: 0, y: 0, w: width, h: window.y },
    { x: 0, y: window.y, w: window.x, h: window.h },
    { x: window.x + window.w, y: window.y, w: width - window.x - window.w, h: window.h },
    { x: 0, y: window.y + window.h, w: width, h: Math.max(0, height - window.y - window.h) }
  ];
}

/**
 * The size of the app's screen, as the veil covers it.
 *
 * @param app - The running app.
 * @returns Its width and height in reference units.
 */
function screenOf(app: GuideApp): { w: number; h: number } {
  const { width, height } = app.renderer.viewport.size();

  return { w: width, h: height };
}

describe("the veil of a guide", () => {
  // Bug caught: the window misses the padding, or the veil is cut over the wrong place.
  it("cuts the window over the padded target, black at 0.6, and locks outside it", async () => {
    const { app, locks } = await headless("padded");
    const window = { x: 36, y: 1496, w: 124, h: 128 };

    expect(veil(app)).toEqual(around(app, window).map(rect => ({ ...rect, fill: 0, alpha: 0.6 })));
    // The window is handed once, at the start; a standing target hands nothing more.
    expect(locks).toEqual([window]);
    expect(app.ui.rectOf({ projection: "guide.board", key: "seat0" })).toEqual({
      x: 40,
      y: 1500,
      w: 116,
      h: 120
    });
  });

  // Bug caught: the window is cut once, at the call, and stays where the target was.
  it("follows a target that moves, in the frame it moved", async () => {
    const { app } = await headless("piece");
    const piece = entityOf(app, PIECE);

    expect(veil(app)).toMatchObject(around(app, { x: 468, y: 668, w: 64, h: 64 }));

    app.world.ecs.set(piece, Transform, { x: 512.25 });
    frames(app, 1);

    expect(veil(app)).toMatchObject(around(app, { x: 480.25, y: 668, w: 64, h: 64 }));
  });

  // Bug caught: a list of targets cuts the window over the first one only.
  it("cuts one window around every shown target of a list", async () => {
    const { app } = await headless("list");

    expect(veil(app)).toMatchObject(around(app, { x: 40, y: 250, w: 680, h: 1370 }));
  });

  it("draws the veil in the guide's colour and alpha", async () => {
    const { app } = await headless("tinted");

    expect(veil(app).map(rect => [rect.fill, rect.alpha])).toEqual([
      [0x0d_2f_33, 0.5],
      [0x0d_2f_33, 0.5],
      [0x0d_2f_33, 0.5],
      [0x0d_2f_33, 0.5]
    ]);
  });

  // Bug caught: a clear veil or no veil at all also drops the lock.
  it("draws nothing visible at alpha 0 and nothing at all for veil: false, and locks both", async () => {
    const clear = await headless("clear");

    expect(veil(clear.app).map(rect => rect.alpha)).toEqual([0, 0, 0, 0]);
    expect(clear.locks).toEqual([{ x: 40, y: 1500, w: 116, h: 120 }]);
    await clear.app.stop();

    const bare = await headless("bare");

    expect(veil(bare.app)).toEqual([]);
    // The lock stands until the guide's end lifts it.
    bare.app.flow.gate.answer({ intent: "seat", payload: { step: "none" } });
    await tick();
    frames(bare.app, 1);

    expect(bare.locks).toEqual([{ x: 40, y: 1500, w: 116, h: 120 }, undefined]);
  });

  // Bug caught: a guide with no target lets every press through under a full veil.
  it("covers the whole screen and locks everything without a target, or while none is shown", async () => {
    const blind = await headless("blind");

    expect(veil(blind.app)).toMatchObject([{ x: 0, y: 0, ...screenOf(blind.app) }]);
    // eslint-disable-next-line unicorn/no-null -- `null` is the lock of everything.
    expect(blind.locks).toEqual([null]);
    await blind.app.stop();

    const { app, locks } = await headless("piece");

    app.world.projection.unmount(["guide.pieces"]);
    frames(app, 2);

    expect(veil(app)).toMatchObject([
      { x: 0, y: 0, ...screenOf(app) },
      { x: 0, y: 0, w: 0, h: 0 },
      { x: 0, y: 0, w: 0, h: 0 },
      { x: 0, y: 0, w: 0, h: 0 }
    ]);
    // eslint-disable-next-line unicorn/no-null -- `null` is the lock of everything.
    expect(locks).toEqual([{ x: 468, y: 668, w: 64, h: 64 }, null]);

    app.world.projection.mount(["guide.pieces"], { kind: "plugin", name: "test" });
    frames(app, 2);

    expect(veil(app)).toMatchObject(around(app, { x: 468, y: 668, w: 64, h: 64 }));
    expect(locks.at(-1)).toEqual({ w: 64, h: 64, x: 468, y: 668 });
  });

  // Bug caught: a new step draws a second veil over the first, or the old one stays.
  it("replaces the guide shown when the node guides another step, and takes it down at the end", async () => {
    const { app, locks } = await headless("seat", "padded");

    expect(app.flow.gate.answer({ intent: "seat", payload: { step: "padded" } })).toBe(true);
    await tick();
    frames(app, 1);

    expect(veil(app)).toEqual(
      around(app, { x: 36, y: 1496, w: 124, h: 128 }).map(rect => ({
        ...rect,
        fill: 0,
        alpha: 0.6
      }))
    );
    // The seat's window, lifted with its node, then the padded one.
    expect(locks).toEqual([
      { x: 40, y: 1500, w: 116, h: 120 },
      undefined,
      { x: 36, y: 1496, w: 124, h: 128 }
    ]);

    expect(app.flow.gate.answer({ intent: "seat", payload: { step: "none" } })).toBe(true);
    await tick();
    frames(app, 1);

    expect(veil(app)).toEqual([]);
    expect(locks.at(-1)).toBeUndefined();
  });

  // Bug caught: a target an edge just made warns and flashes a full veil for a frame, or a key that
  // names nothing is never named, and the tutorial soft-locks without a word.
  it("names a key that names no entity two frames in a row, once, in a dev build only", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);

    const { app, locks } = await headless("none");
    const missing = {
      allow: { intent: "seat" },
      target: { projection: "guide.board", key: "nowhere" }
    };

    app.flow.fx.dispatch(guide(missing));

    // The first placement veils the screen and locks every press, as before; it names nothing yet.
    expect(veil(app)[0]).toMatchObject({ x: 0, y: 0, ...screenOf(app) });
    // eslint-disable-next-line unicorn/no-null -- `null` is the lock of everything.
    expect(locks).toEqual([null]);
    expect(logged(app, "ui:guide-target-missing")).toEqual([]);

    frames(app, 1);

    expect(logged(app, "ui:guide-target-missing")).toEqual([]);

    frames(app, 4);

    expect(logged(app, "ui:guide-target-missing")).toEqual([
      { targets: [{ projection: "guide.board", key: "nowhere" }] }
    ]);

    vi.unstubAllGlobals();

    const quiet = await headless("missing");

    frames(quiet.app, 4);

    expect(logged(quiet.app, "ui:guide-target-missing")).toEqual([]);
    await quiet.app.stop();
  });

  // Bug caught: a node that derives the same guide again in the tick its edge committed finds the
  // view the edge made before the world laid it out, and flashes a full veil and a full lock.
  it("keeps the window of the guide it replaced while the same targets are not laid out yet", async () => {
    const { app, locks } = await headless("piece");
    const window = { x: 468, y: 668, w: 64, h: 64 };
    const piece = entityOf(app, PIECE);

    // The piece is not drawn when the node guides again in the tick of its edge, as a view the
    // edge made and the world has not laid out yet.
    app.world.ecs.set(piece, Sprite, { alpha: 0 });
    expect(app.flow.gate.answer({ intent: "blocked" })).toBe(true);
    await tick();

    expect(locks).toEqual([window, undefined, window]);
    expect(veil(app)).toMatchObject(around(app, window));

    app.world.ecs.set(piece, Sprite, { alpha: 1 });
    app.world.ecs.set(piece, Transform, { x: 512.25 });
    frames(app, 1);

    // The piece shows again: the window is the piece's own, followed from there.
    expect(locks).toEqual([window, undefined, window]);
    expect(veil(app)).toMatchObject(around(app, { ...window, x: 480.25 }));
  });

  it("takes no window over from a guide of other targets", async () => {
    const { app, locks } = await headless("piece");

    expect(app.flow.gate.answer({ intent: "seat", payload: { step: "missing" } })).toBe(true);
    await tick();

    // eslint-disable-next-line unicorn/no-null -- `null` is the lock of everything.
    expect(locks).toEqual([{ x: 468, y: 668, w: 64, h: 64 }, undefined, null]);
    expect(veil(app)[0]).toMatchObject({ x: 0, y: 0, ...screenOf(app) });
  });

  it("veils the screen once its grace ends and the targets still are not shown", async () => {
    const { app, locks } = await headless("piece");
    const window = { x: 468, y: 668, w: 64, h: 64 };

    app.world.ecs.set(entityOf(app, PIECE), Sprite, { alpha: 0 });
    expect(app.flow.gate.answer({ intent: "blocked" })).toBe(true);
    await tick();
    frames(app, 2);

    expect(locks).toEqual([window, undefined, window]);
    expect(veil(app)).toMatchObject(around(app, window));

    frames(app, 1);

    // The lock of everything.
    expect(locks.at(-1)).toBeNull();
    expect(veil(app)[0]).toMatchObject({ x: 0, y: 0, ...screenOf(app) });
  });
});

describe("a text field under the lock of a guide", () => {
  // Bug caught: the keyboard opens on a field the veil covers, though its tap is locked.
  it("focuses no field outside the window, and the field inside as before", async () => {
    const { app, page } = await startFieldApp({ dom: true, innerHeight: 1920 });
    const input = page?.dom.inputs[0];

    if (page === undefined || input === undefined) throw new Error("no hidden input was made");

    mountScreen(app, "profile");
    app.flow.fx.dispatch(
      guide({ allow: { intent: "rename" }, target: { projection: "profile", key: "nickField" } })
    );
    app.time.step(16);

    page.canvas.pointer("pointerdown", 100, 1340);
    page.canvas.pointer("pointerup", 100, 1340);

    expect(input.focusCalls).toEqual([]);

    page.canvas.pointer("pointerdown", 100, 40);
    page.canvas.pointer("pointerup", 100, 40);

    expect(input.focusCalls).toEqual([{ preventScroll: true }]);

    await app.stop();
  });
});

/**
 * Starts the fixture at a step, drawn, so a press goes through input's hit test.
 *
 * @param step - The step the session starts at.
 * @returns The app and its fake Pixi.
 */
async function drawn(step: GuideStep) {
  const started = await startGuideApp({ step, drawn: true });
  const { pixi } = started;

  running = started.app;
  if (pixi === undefined) throw new Error("the drawn fixture has no Pixi");

  frames(started.app, 2);

  return { app: started.app, pixi };
}

/**
 * The outcomes of the edges the graph took, in order.
 *
 * @param app - The running app.
 * @returns The outcome names.
 */
function outcomes(app: GuideApp): string[] {
  return app.flow.history().map(entry => entry.outcome);
}

describe("the lock of a guide under a finger", () => {
  // Bug caught: the button under the veil answers, so the tutorial loses its step.
  it("answers blocked for a press on a button outside the window, never the button", async () => {
    const { app, pixi } = await drawn("seat");

    await tapAt(app, pixi, { x: 700, y: 1100 });

    expect(outcomes(app)).toEqual(["blocked"]);
  });

  it("applies no local write and pans no scroll outside the window", async () => {
    const { app, pixi } = await drawn("seat");

    await tapAt(app, pixi, { x: 400, y: 1100 });
    await dragAt(app, pixi, { x: 190, y: 600 }, { x: 190, y: 350 });

    expect(app.ui.find("flag")).toBeUndefined();
    expect(app.world.ecs.get(app.ui.find("list") ?? 0, ScrollState)?.offset).toBe(0);
    expect(outcomes(app)).toEqual(["blocked", "blocked"]);
  });

  // Bug caught: the lock refuses the one press the tutorial asks for.
  it("lets a press inside the window reach its button", async () => {
    const { app, pixi } = await drawn("seat");

    await tapAt(app, pixi, { x: 98, y: 1560 });

    expect(outcomes(app)).toEqual(["seat", "done"]);
  });

  it("locks with no veil drawn, and everything when the guide has no target", async () => {
    const bare = await drawn("bare");

    await tapAt(bare.app, bare.pixi, { x: 700, y: 1100 });

    expect(outcomes(bare.app)).toEqual(["blocked"]);
    await bare.app.stop();

    const blind = await drawn("blind");

    await tapAt(blind.app, blind.pixi, { x: 98, y: 1560 });

    expect(outcomes(blind.app)).toEqual(["blocked"]);
  });

  it("takes presses everywhere again once no guide stands", async () => {
    const { app, pixi } = await drawn("none");

    await tapAt(app, pixi, { x: 700, y: 1100 });
    await tapAt(app, pixi, { x: 400, y: 1100 });

    expect(outcomes(app)).toEqual(["outside"]);
    expect(app.ui.find("flag")).toBeDefined();
  });
});
