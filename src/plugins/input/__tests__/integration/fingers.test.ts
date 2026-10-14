import { afterEach, describe, expect, it } from "vitest";
import { createApp, defineGame, screen, Transform, type } from "../../../../index";
import { projection } from "../../../world/projection/define";
import type { Entity } from "../../../world/types";
import {
  Draggable,
  DropTarget,
  Held,
  Hovered,
  Pointer,
  Pressed,
  Tappable,
  Touchable
} from "../../components";

// ---------------------------------------------------------------------------
// Integration: the aim of a carried view and the finger that gives way, on the real time,
// lifecycle, model, clock, flow, world, renderer and input plugins, in plain Bun. The renderer is
// inert, so the test hands input what a page hands it: a canvas that keeps the listeners input
// attaches, and a hit test over the square views of the fixture. Fingers are pointer events sent
// to those listeners; every decision is the engine's own frame step.
// ---------------------------------------------------------------------------

/** A point of the frame, in reference units; the inert viewport maps one client pixel to one. */
type Point = { x: number; y: number };

/** One drop the graph took. */
type Drop = { from: string; to: string };

/** The save holds whether the item `aimed` aims by its picture. */
type Player = { aimed: boolean };

/** What the graph took: the drops in order and the taps of `go`. */
type Session = { drops: Drop[]; goes: number };

/** The side of every small view, in its own units. */
const SIDE = 50;

/** Where the picture of the item `aimed` is, in its own units: above the middle of its handle. */
const AIM: Point = { x: 25, y: 12 };

/** Where a finger takes an item: the lower part of its handle. */
const GRIP: Point = { x: 25, y: 40 };

/** The move that takes a pressed item into the hand: past `dragStartPx` (8). */
const LIFT_MOVE = 10;

/** A point no view covers. */
const NOWHERE: Point = { x: 900, y: 900 };

/** The two drop targets, `b` right under `a`. */
const TARGETS = [
  { id: "a", x: 0, y: 0 },
  { id: "b", x: 0, y: SIDE }
];

/** The two items: `aimed` aims by its picture while the player says so, `plain` names no aim. */
const ITEMS = [
  { id: "aimed", x: 100, y: 200 },
  { id: "plain", x: 200, y: 200 }
];

/** The button `go`. */
const GO: Point = { x: 300, y: 0 };

/** The pan surface: a `Touchable` 400 x 400 view below the items. */
const PAN = { x: 0, y: 300, side: 400 };

const { defineNode, defineFlow, defineFeature } = defineGame<{
  player: Player;
  session: Session;
  assets: string;
  strings: Record<string, unknown>;
}>();

const fingerTargets = projection({
  name: "fingers.targets",
  layer: "board",
  from: () => TARGETS,
  key: (target: { id: string }) => target.id,
  view: (target: { id: string; x: number; y: number }) => [
    Transform({ x: target.x, y: target.y }),
    DropTarget({ intent: "drop", payload: { to: target.id } })
  ]
});

const fingerItems = projection({
  name: "fingers.items",
  layer: "board",
  from: (player: Player) =>
    ITEMS.map(item => ({ ...item, aim: item.id === "aimed" && player.aimed ? AIM : undefined })),
  key: (item: { id: string }) => item.id,
  view: (item: { id: string; x: number; y: number; aim: Point | undefined }) => [
    Transform({ x: item.x, y: item.y }),
    // A projection takes the aim away by not giving it.
    Draggable({ payload: { from: item.id }, ...(item.aim === undefined ? {} : { aim: item.aim }) })
  ]
});

const fingerControls = projection({
  name: "fingers.controls",
  layer: "board",
  from: () => ["go", "pan"],
  key: (name: string) => name,
  view: (name: string) =>
    name === "go"
      ? [Transform({ x: GO.x, y: GO.y }), Tappable({ intent: "go" })]
      : [Transform({ x: PAN.x, y: PAN.y }), Touchable()]
});

const rest = defineNode({
  outcomes: { drop: type<Drop>(), go: type(), plain: type() },
  rest: true
});

const noteDrop = defineNode({
  input: type<Drop>(),
  outcomes: { done: type() },
  run: ({ session, input, out }) => {
    session.drops.push({ from: input.from, to: input.to });

    return out.done();
  }
});

const noteGo = defineNode({
  outcomes: { done: type() },
  run: ({ session, out }) => {
    session.goes += 1;

    return out.done();
  }
});

const forgetAim = defineNode({
  outcomes: { done: type() },
  run: ({ player, out }) => {
    player.aimed = false;

    return out.done();
  }
});

const fingersFlow = defineFlow("main", {
  nodes: { rest, noteDrop, noteGo, forgetAim },
  start: "rest",
  edges: {
    rest: { drop: "noteDrop", go: "noteGo", plain: "forgetAim" },
    noteDrop: { done: "rest" },
    noteGo: { done: "rest" },
    forgetAim: { done: "rest" }
  }
});

const fingersFeature = defineFeature("fingers", {
  flows: [fingersFlow],
  projections: [fingerTargets, fingerItems, fingerControls]
});

/**
 * Creates the fixture app: the screen set and the fingers feature.
 *
 * @returns The app, not started.
 */
function createFingersApp() {
  return createApp({
    plugins: [...screen, fingersFeature],
    pluginConfigs: {
      flow: { mainFlow: fingersFlow },
      model: {
        initialPlayer: { aimed: true },
        initialSession: { drops: [], goes: 0 },
        seed: 1
      }
    }
  });
}

/** The fixture app. */
type App = ReturnType<typeof createFingersApp>;

/** The pointer events a finger of the test sends. */
type PointerName = "pointerdown" | "pointermove" | "pointerup" | "lostpointercapture";

/** What input reads of a DOM pointer event. */
type PointerSeen = {
  pointerType: "touch";
  pointerId: number;
  clientX: number;
  clientY: number;
  preventDefault: () => void;
};

/** A running fixture. */
type Page = {
  app: App;
  /** Sends one pointer event of a finger to the listeners input put on the canvas. */
  touch: (name: PointerName, finger: number, at: Point) => void;
  /** Lets the graph settle, then steps one frame of 16 ms, `count` times. */
  frames: (count?: number) => Promise<void>;
  /** The entity of a view of the fixture. */
  view: (projectionName: string, key: string) => Entity;
  /** What the graph took so far. */
  session: () => Session;
};

/** The views the hit test walks, topmost first: the items above the controls and the targets. */
const DRAWN = [
  ...ITEMS.map(item => ({ projection: "fingers.items", key: item.id, side: SIDE })),
  { projection: "fingers.controls", key: "go", side: SIDE },
  ...TARGETS.map(target => ({ projection: "fingers.targets", key: target.id, side: SIDE })),
  { projection: "fingers.controls", key: "pan", side: PAN.side }
];

const running: App[] = [];

/**
 * The page's canvas, as input sees it: it keeps one listener per event name and takes the pointer
 * capture silently.
 *
 * @param listeners - Where the listeners are kept, by event name.
 * @returns The canvas `renderer.host.canvas()` answers with.
 */
function fakeCanvas(listeners: Map<string, (event: PointerSeen) => void>): HTMLCanvasElement {
  const canvas = {
    style: { touchAction: "", cursor: "" },
    addEventListener: (name: string, listener: (event: PointerSeen) => void): void => {
      listeners.set(name, listener);
    },
    removeEventListener: (name: string): void => {
      listeners.delete(name);
    },
    setPointerCapture: (): void => undefined,
    releasePointerCapture: (): void => undefined,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1080, height: 1920 })
  };

  return canvas as unknown as HTMLCanvasElement;
}

/**
 * The renderer's hit test over the fixture: the topmost accepted view whose square, from its
 * `Transform` on, holds the point. No view has a parent, a turn or a scale.
 *
 * @param app - The fixture app.
 * @returns The hit test.
 */
function squareHitTest(app: App) {
  return (x: number, y: number, accept: (entity: Entity) => boolean): Entity | undefined => {
    for (const drawn of DRAWN) {
      const entity = app.world.projection.entityOf(drawn.projection, drawn.key);
      const pose = entity === undefined ? undefined : app.world.ecs.get(entity, Transform);

      if (entity === undefined || pose === undefined) continue;

      const inside =
        x >= pose.x && x < pose.x + drawn.side && y >= pose.y && y < pose.y + drawn.side;

      if (inside && accept(entity)) return entity;
    }

    return undefined;
  };
}

/**
 * Starts the fixture on its rest node with the canvas and the hit test in place.
 *
 * @returns The running page.
 */
async function open(): Promise<Page> {
  const app = createFingersApp();
  const listeners = new Map<string, (event: PointerSeen) => void>();
  const canvas = fakeCanvas(listeners);

  running.push(app);
  await app.start();
  app.flow.run().catch(() => undefined);
  Object.assign(app.renderer.host, { canvas: () => canvas });
  Object.assign(app.renderer.sync, { hitTest: squareHitTest(app) });
  app.world.projection.setLayers([{ name: "board", sort: "none" }]);
  app.world.projection.mount(["fingers.targets", "fingers.items", "fingers.controls"], {
    kind: "plugin",
    name: "test"
  });

  const page: Page = {
    app,
    touch: (name, finger, at) => {
      listeners.get(name)?.({
        pointerType: "touch",
        pointerId: finger,
        clientX: at.x,
        clientY: at.y,
        preventDefault: () => undefined
      });
    },
    frames: async (count = 1) => {
      for (let frame = 0; frame < count; frame += 1) {
        await new Promise(resolve => setTimeout(resolve, 0));
        app.time.step(16);
      }
    },
    view: (projectionName, key) => {
      const entity = app.world.projection.entityOf(projectionName, key);

      if (entity === undefined) throw new Error(`The fixture has no view ${key}.`);

      return entity;
    },
    session: () => app.model.store.snapshot().session as Session
  };

  // The first frames mount the views and move the listeners onto the canvas.
  await page.frames(3);

  return page;
}

/**
 * Where an item rests.
 *
 * @param id - The item.
 * @returns Its top-left corner.
 */
function itemAt(id: string): Point {
  const item = ITEMS.find(entry => entry.id === id);

  return { x: item?.x ?? 0, y: item?.y ?? 0 };
}

/**
 * Where the finger is when the item it carries stands at `view`: input takes the item at the move
 * that lifts it, so the item keeps the offset it had there.
 *
 * @param view - Where the top-left corner of the item shall stand.
 * @returns The point of the finger.
 */
function fingerFor(view: Point): Point {
  return { x: view.x + GRIP.x, y: view.y + GRIP.y - LIFT_MOVE };
}

/**
 * A finger presses an item at its grip and lifts it into the hand.
 *
 * @param page - The running page.
 * @param finger - The pointer id.
 * @param id - The item.
 */
async function take(page: Page, finger: number, id: string): Promise<void> {
  const item = itemAt(id);

  page.touch("pointerdown", finger, { x: item.x + GRIP.x, y: item.y + GRIP.y });
  await page.frames();
  page.touch("pointermove", finger, fingerFor(item));
  await page.frames();
}

/**
 * A finger that holds an item carries it to `at` and lifts there; the item settles home after.
 *
 * @param page - The running page.
 * @param finger - The pointer id.
 * @param at - Where the finger lifts.
 */
async function dropAt(page: Page, finger: number, at: Point): Promise<void> {
  page.touch("pointermove", finger, at);
  await page.frames();
  page.touch("pointerup", finger, at);
  await page.frames(30);
}

/** The item stands at (0, 28): its picture, at y 40, is on `a`; the finger, at y 58, is on `b`. */
const PICTURE_ON_A = fingerFor({ x: 0, y: 28 });

/** The middle of each target, for an item that names no aim. */
const ON_A: Point = { x: 25, y: 25 };
const ON_B: Point = { x: 25, y: 75 };

/** A point of the button `go` and of the pan surface. */
const ON_GO: Point = { x: GO.x + 25, y: GO.y + 25 };
const ON_PAN: Point = { x: 200, y: 500 };

afterEach(async () => {
  for (const app of running.splice(0)) await app.stop();
});

describe("the aim of a carried view", () => {
  it("drops a dragged item that names an aim on the target under its picture, and marks that target while it is carried", async () => {
    const page = await open();
    const { ecs } = page.app.world;

    await take(page, 1, "aimed");
    page.touch("pointermove", 1, PICTURE_ON_A);
    await page.frames();

    expect(ecs.has(page.view("fingers.targets", "a"), Hovered)).toBe(true);
    expect(ecs.has(page.view("fingers.targets", "b"), Hovered)).toBe(false);

    page.touch("pointerup", 1, PICTURE_ON_A);
    await page.frames(4);

    expect(page.session().drops).toEqual([{ from: "aimed", to: "a" }]);
  });

  it("a projection that stops giving an aim takes it away: the next drop goes under the finger", async () => {
    const page = await open();
    const aimed = page.view("fingers.items", "aimed");

    expect(page.app.flow.gate.answer({ intent: "plain" })).toBe(true);
    await page.frames(2);

    expect(page.app.world.ecs.get(aimed, Draggable)?.aim).toBeNull();

    await take(page, 1, "aimed");
    await dropAt(page, 1, PICTURE_ON_A);

    expect(page.session().drops).toEqual([{ from: "aimed", to: "b" }]);
  });
});

describe("a finger that has not started a gesture gives way", () => {
  it("a thumb resting on the background does not block a drag on the board; its move and its lift end nothing", async () => {
    const page = await open();
    const plain = page.view("fingers.items", "plain");

    page.touch("pointerdown", 7, NOWHERE);
    await page.frames();
    await take(page, 1, "plain");

    expect(page.app.world.ecs.has(plain, Held)).toBe(true);

    page.touch("pointermove", 7, { x: NOWHERE.x + 2, y: NOWHERE.y + 1 });
    page.touch("pointerup", 7, { x: NOWHERE.x + 2, y: NOWHERE.y + 1 });
    await page.frames();

    expect(page.app.world.ecs.has(plain, Held)).toBe(true);

    await dropAt(page, 1, ON_A);

    expect(page.session().drops).toEqual([{ from: "plain", to: "a" }]);
  });

  it("after a takeover the board still takes input", async () => {
    const page = await open();
    const { ecs } = page.app.world;

    page.touch("pointerdown", 7, NOWHERE);
    await page.frames();
    await take(page, 1, "plain");
    await dropAt(page, 1, ON_B);

    expect(page.session().drops).toEqual([{ from: "plain", to: "b" }]);

    // The thumb lifted off the canvas once its capture was released: no up, only the lost capture.
    page.touch("lostpointercapture", 7, NOWHERE);
    await page.frames();
    page.touch("pointerdown", 2, ON_GO);
    await page.frames();
    page.touch("pointerup", 2, ON_GO);
    await page.frames(4);

    expect(page.session().goes).toBe(1);

    await take(page, 3, "plain");
    await dropAt(page, 3, ON_A);

    expect(page.session()).toEqual({
      drops: [
        { from: "plain", to: "b" },
        { from: "plain", to: "a" }
      ],
      goes: 1
    });
    expect(ecs.has(page.view("fingers.items", "plain"), Held)).toBe(false);
    expect(ecs.has(page.view("fingers.items", "aimed"), Held)).toBe(false);
    expect(ecs.resource(Pointer)).toMatchObject({ down: false, id: -1 });
  });

  it("a thumb resting on the pan surface does not block a drag of an item", async () => {
    const page = await open();
    const { ecs } = page.app.world;
    const pan = page.view("fingers.controls", "pan");
    const plain = itemAt("plain");

    page.touch("pointerdown", 7, ON_PAN);
    await page.frames();

    expect(ecs.has(pan, Pressed)).toBe(true);

    page.touch("pointerdown", 1, { x: plain.x + GRIP.x, y: plain.y + GRIP.y });
    await page.frames();

    expect(ecs.has(pan, Pressed)).toBe(false);
    expect(ecs.resource(Pointer).id).toBe(1);

    page.touch("pointermove", 1, fingerFor(plain));
    await page.frames();
    await dropAt(page, 1, ON_A);

    expect(page.session().drops).toEqual([{ from: "plain", to: "a" }]);
  });

  it("a palm resting on the board does not block a drag", async () => {
    const page = await open();
    const { ecs } = page.app.world;
    const aimed = page.view("fingers.items", "aimed");
    const resting = itemAt("aimed");

    page.touch("pointerdown", 7, { x: resting.x + GRIP.x, y: resting.y + GRIP.y });
    await page.frames();

    expect(ecs.has(aimed, Pressed)).toBe(true);
    expect(ecs.has(aimed, Held)).toBe(false);

    await take(page, 1, "plain");
    await dropAt(page, 1, ON_B);

    expect(page.session().drops).toEqual([{ from: "plain", to: "b" }]);
    expect(ecs.has(aimed, Pressed)).toBe(false);
    expect(ecs.has(aimed, Held)).toBe(false);

    page.touch("pointerup", 7, { x: resting.x + GRIP.x, y: resting.y + GRIP.y });
    await page.frames(4);

    expect(page.session()).toEqual({ drops: [{ from: "plain", to: "b" }], goes: 0 });
  });
});

describe("a finger that started a gesture keeps it", () => {
  it("a finger that started dragging an item owns the gesture: a second finger's drag of another item is not heard", async () => {
    const page = await open();
    const { ecs } = page.app.world;
    const aimed = page.view("fingers.items", "aimed");

    await take(page, 1, "plain");

    expect(ecs.has(page.view("fingers.items", "plain"), Held)).toBe(true);

    await take(page, 2, "aimed");
    page.touch("pointermove", 2, PICTURE_ON_A);
    await page.frames();
    page.touch("pointerup", 2, PICTURE_ON_A);
    await page.frames(4);

    expect(ecs.has(aimed, Held)).toBe(false);
    expect(page.session().drops).toEqual([]);

    await dropAt(page, 1, ON_B);

    expect(page.session().drops).toEqual([{ from: "plain", to: "b" }]);
  });

  it("an active pan keeps the gesture against a second finger", async () => {
    const page = await open();
    const pan = page.view("fingers.controls", "pan");

    page.touch("pointerdown", 7, ON_PAN);
    await page.frames();
    page.touch("pointermove", 7, { x: ON_PAN.x, y: ON_PAN.y + 30 });
    await page.frames();
    page.touch("pointerdown", 1, ON_GO);
    await page.frames();
    page.touch("pointerup", 1, ON_GO);
    await page.frames(4);

    expect(page.session().goes).toBe(0);
    expect(page.app.world.ecs.has(pan, Pressed)).toBe(true);

    page.touch("pointerup", 7, { x: ON_PAN.x, y: ON_PAN.y + 30 });
    await page.frames();
    page.touch("pointerdown", 1, ON_GO);
    await page.frames();
    page.touch("pointerup", 1, ON_GO);
    await page.frames(4);

    expect(page.session().goes).toBe(1);
  });
});
