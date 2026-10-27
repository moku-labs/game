/**
 * @file ui plugin — the app of the guide tests (F98). Not a test file. The board of "A Memory
 * Missing" cut down: an order strip (an x scroll of 306 u at 40, 1500 over a 696 u track of two
 * seats, 116 x 120 each; the first seat answers `seat` with the step it leads to), a fitted board
 * (800 u drawn at 0.5 in a 400 u slot at 600, 200) with a cell, a button `outside` at 600, 1000, a
 * local-state button `local` at 300, 1000 that shows the element `flag`, and a y scroll `list` at
 * 40, 300 of 300 x 400 over 1200 u; and a world piece, a 64 u sprite centred at 500, 700. The one
 * rest node `home` holds a guide derived from `session.step`; `seat` leads to `setStep`, which
 * writes the step it carries. Real flow, world, text and Yoga; headless with an inert renderer, or
 * drawn on the fake page and the fake Pixi, where a press is a pointer event on the canvas.
 */
import type { Log } from "@moku-labs/common/browser";
import {
  createApp,
  defineGame,
  type Flow,
  projection,
  Sprite,
  Transform,
  type
} from "../../../index";
import { animPlugin } from "../../anim";
import { assetsPlugin } from "../../assets";
import { i18nPlugin } from "../../i18n";
import { inputPlugin } from "../../input";
import { rendererPlugin } from "../../renderer";
import { type FakeDom, installFakeDom } from "../../renderer/__tests__/fake-dom";
import { createFakePixi, type FakePixi, FakeTexture } from "../../renderer/__tests__/fake-pixi";
import { scenesPlugin } from "../../scenes";
import { textPlugin } from "../../text";
import { worldPlugin } from "../../world";
import type { AnchorTarget } from "../../world/projection/types";
import { uiPlugin } from "../index";
import { defineComponent } from "../jsx/component";

/** The first seat of the strip. */
export const SEAT0: AnchorTarget = { projection: "guide.board", key: "seat0" };

/** The cell of the fitted board. */
export const CELL: AnchorTarget = { projection: "guide.board", key: "cell" };

/** The world piece. */
export const PIECE: AnchorTarget = { projection: "guide.pieces", key: "piece" };

/** A key no projection has. */
export const NOWHERE: AnchorTarget = { projection: "guide.board", key: "nowhere" };

/** The answer a press outside the window gives in the steps that name one. */
const BLOCKED = { intent: "blocked" } as const;

/** The guide of each step of the tutorial. */
const STEPS = {
  none: undefined,
  seat: { allow: { intent: "seat" }, target: SEAT0, blocked: BLOCKED },
  padded: { allow: { intent: "seat" }, target: SEAT0, pad: 4 },
  list: { allow: { intent: "seat" }, target: [SEAT0, CELL] },
  piece: { allow: { intent: "seat" }, target: PIECE, blocked: BLOCKED },
  blind: { allow: { intent: "seat" }, blocked: BLOCKED },
  clear: { allow: { intent: "seat" }, target: SEAT0, veil: { alpha: 0 }, blocked: BLOCKED },
  bare: { allow: { intent: "seat" }, target: SEAT0, veil: false, blocked: BLOCKED },
  tinted: { allow: { intent: "seat" }, target: SEAT0, veil: { color: 0x0d_2f_33, alpha: 0.5 } },
  missing: { allow: { intent: "seat" }, target: NOWHERE }
} as const satisfies Record<string, Flow.GuideOptions | undefined>;

/** A step of the tutorial. */
export type GuideStep = keyof typeof STEPS;

/**
 * The board: the strip, the fitted board, a button outside every window, a local-state button and
 * a y scroll. The first seat answers `seat` with the step the board goes to.
 */
export const Board = defineComponent("Board", {
  local: { on: false },
  view: (props: { next: GuideStep }, local) => (
    <stack key="boardRoot" style={{ width: 1080, height: 1920 }}>
      <scroll key="strip" axis="x" style={{ left: 40, top: 1500, width: 306, height: 120 }}>
        <row key="track" style={{ width: 696, height: 120 }}>
          <button
            key="seat0"
            intent="seat"
            payload={{ step: props.next }}
            style={{ width: 116, height: 120 }}
          />
          <button key="seat1" intent="seat" style={{ width: 116, height: 120 }} />
        </row>
      </scroll>
      <stack key="fitSlot" style={{ left: 600, top: 200, width: 400, height: 400 }}>
        <stack key="fitBoard" style={{ width: 800, height: 800, fit: "contain" }}>
          <button
            key="cell"
            intent="cell"
            style={{ left: 100, top: 100, width: 140, height: 140 }}
          />
        </stack>
      </stack>
      <button
        key="outside"
        intent="outside"
        style={{ position: "absolute", left: 600, top: 1000, width: 200, height: 200, reason: "o" }}
      />
      <button
        key="local"
        local={{ on: true }}
        style={{ position: "absolute", left: 300, top: 1000, width: 200, height: 200, reason: "l" }}
      />
      {local.on ? (
        <stack
          key="flag"
          style={{ position: "absolute", left: 0, top: 0, width: 10, height: 10, reason: "f" }}
        />
      ) : undefined}
      <scroll
        key="list"
        style={{ position: "absolute", left: 40, top: 300, width: 300, height: 400, reason: "s" }}
      >
        <column key="listBody" style={{ width: 300, height: 1200 }} />
      </scroll>
    </stack>
  )
});

/** The board's projection. */
const board = projection({
  name: "guide.board",
  layer: "ui",
  from: (_player: { visits: number }, session: { step: GuideStep; next: GuideStep }) => ({
    id: "board",
    next: session.next
  }),
  view: (item: { next: GuideStep }) => <Board key="boardView" next={item.next} />
});

/** The world piece: a 64 u sprite centred on its `Transform`. */
const pieces = projection({
  name: "guide.pieces",
  layer: "board",
  from: (): { id: string }[] => [{ id: "piece" }],
  key: (item: { id: string }) => item.id,
  view: () => [
    Sprite({ texture: "ui.coin", width: 64, height: 64, anchor: { x: 0.5, y: 0.5 } }),
    Transform({ x: 500, y: 700 })
  ]
});

/** The session of the fixture: the step the guide shows, and the one the first seat leads to. */
type Session = { step: GuideStep; next: GuideStep };

const { defineNode, defineFlow, defineFeature } = defineGame<{
  player: { visits: number };
  session: Session;
  assets: string;
  strings: Record<string, never>;
}>();

/** The rest node: its guide is the step's. */
const home = defineNode({
  rest: true,
  outcomes: {
    seat: type<{ step?: GuideStep }>(),
    cell: type(),
    outside: type(),
    blocked: type()
  },
  guide: ({ session }) => STEPS[session.step]
});

/** Writes the step the first seat carried, when it carried one. */
const setStep = defineNode({
  input: type<{ step?: GuideStep }>(),
  outcomes: { done: type() },
  run: ({ session, input, out }) => {
    if (input.step !== undefined) session.step = input.step;

    return out.done();
  }
});

const main = defineFlow("main", {
  nodes: { home, setStep },
  start: "home",
  outcomes: {},
  edges: {
    home: { seat: "setStep", cell: "home", outside: "home", blocked: "home" },
    setStep: { done: "home" }
  }
});

/** The feature of the guide fixture. */
const guideFeature = defineFeature("guides", {
  flows: [main],
  projections: [board, pieces],
  ui: [Board]
});

/** Yields the microtask queue to the loop, the way a test waits without a timer. */
export async function tick(times = 60): Promise<void> {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
}

/** How a test starts the guide app. */
export type GuideOptions = {
  /** The step the session starts at. */
  step: GuideStep;
  /** The step the first seat leads to; `none` when left out. */
  next?: GuideStep;
  /** Drawn on the fake page and the fake Pixi, so a press goes through the hit test. */
  drawn?: boolean;
};

/**
 * Builds the guide app, not started yet.
 *
 * @param options - The first step, and whether the app draws.
 * @returns The app and, drawn, its fake page and Pixi.
 */
export function createGuideApp(options: GuideOptions) {
  const dom: FakeDom | undefined = options.drawn
    ? installFakeDom({ width: 1080, height: 1920 })
    : undefined;
  const pixi: FakePixi | undefined = options.drawn ? createFakePixi() : undefined;
  const renderer =
    pixi === undefined
      ? {}
      : { renderer: { mount: "#game", loadPixi: () => Promise.resolve(pixi.module) } };
  const app = createApp({
    plugins: [
      worldPlugin,
      rendererPlugin,
      inputPlugin,
      assetsPlugin,
      scenesPlugin,
      animPlugin,
      i18nPlugin,
      textPlugin,
      uiPlugin,
      guideFeature
    ],
    pluginConfigs: {
      flow: { mainFlow: main },
      i18n: { locale: "en", fallback: "en" },
      model: {
        initialPlayer: { visits: 0 },
        initialSession: { step: options.step, next: options.next ?? "none" },
        seed: 1
      },
      ...renderer
    }
  });

  return { app, dom, pixi };
}

/** The app `createGuideApp` builds. */
export type GuideApp = ReturnType<typeof createGuideApp>["app"];

/**
 * Sets the layers and lets the flow rest on `home`. The board and the piece are mounted and laid
 * out in the `scene` stage of the first node, as a scene is before its node is entered, so the
 * guide of `home` finds its targets drawn. Two frames run after.
 *
 * @param app - The started app.
 */
export async function settleGuideApp(app: GuideApp): Promise<void> {
  const mounted = { done: false };

  app.world.projection.setLayers([
    { name: "board", sort: "order" },
    { name: "ui", sort: "order" }
  ]);

  const offScene = app.flow.onEnter("scene", () => {
    if (mounted.done) return;

    mounted.done = true;
    app.world.projection.mount(["guide.board", "guide.pieces"], { kind: "plugin", name: "test" });
    frames(app, 2);
  });

  app.flow.run().catch(() => undefined);
  await tick();
  offScene();
  frames(app, 2);
  await tick();
}

/**
 * Starts the guide app at a step, headless or drawn, with the board and the piece mounted.
 *
 * @param options - The first step, and whether the app draws.
 * @returns The started app and, drawn, its fake page and Pixi.
 */
export async function startGuideApp(options: GuideOptions) {
  const started = createGuideApp(options);

  await started.app.start();
  started.app.renderer.sync.textures.provide(() => new FakeTexture({}) as never);
  await settleGuideApp(started.app);

  return started;
}

/**
 * Steps frames of 16 ms.
 *
 * @param app - The running app.
 * @param count - How many.
 */
export function frames(app: GuideApp, count: number): void {
  for (let frame = 0; frame < count; frame += 1) app.time.step(16);
}

/**
 * The entity of a keyed element or view, failing the test when it is not there.
 *
 * @param app - The running app.
 * @param target - Its projection and key.
 * @returns The entity.
 */
export function entityOf(app: GuideApp, target: AnchorTarget): number {
  const entity = app.world.projection.entityOf(target.projection, target.key);

  if (entity === undefined) throw new Error(`no entity for "${target.key}"`);

  return entity;
}

/**
 * The payloads of every log entry of one event so far.
 *
 * @param app - The running app.
 * @param event - The event name.
 * @returns The payloads, in order.
 */
export function logged(app: GuideApp, event: string): Array<Log.LogEntry["data"]> {
  return app.log
    .trace()
    .filter(entry => entry.event === event)
    .map(entry => entry.data);
}

/** A point in reference units. */
export type GuidePoint = { x: number; y: number };

/**
 * Dispatches one pointer event of the first touch on the fake canvas, at a point in reference
 * units.
 *
 * @param app - The running app, drawn.
 * @param pixi - Its fake Pixi.
 * @param name - The DOM event name.
 * @param point - Where, in reference units.
 */
export function pointer(app: GuideApp, pixi: FakePixi, name: string, point: GuidePoint): void {
  const client = app.renderer.viewport.toScreen(point);

  pixi.last().canvas.dispatch(name, {
    pointerType: "touch",
    pointerId: 1,
    clientX: client.x,
    clientY: client.y,
    preventDefault: () => undefined
  });
}

/**
 * A tap at a point: down, a frame, up, a frame, and the runner's turn.
 *
 * @param app - The running app, drawn.
 * @param pixi - Its fake Pixi.
 * @param point - Where, in reference units.
 */
export async function tapAt(app: GuideApp, pixi: FakePixi, point: GuidePoint): Promise<void> {
  pointer(app, pixi, "pointerdown", point);
  frames(app, 1);
  pointer(app, pixi, "pointerup", point);
  frames(app, 1);
  await tick();
  frames(app, 1);
}

/**
 * A drag from one point to another in four steps, a frame after each, then the release.
 *
 * @param app - The running app, drawn.
 * @param pixi - Its fake Pixi.
 * @param from - Where the finger goes down, in reference units.
 * @param to - Where it is lifted, in reference units.
 */
export async function dragAt(
  app: GuideApp,
  pixi: FakePixi,
  from: GuidePoint,
  to: GuidePoint
): Promise<void> {
  pointer(app, pixi, "pointerdown", from);
  frames(app, 1);

  for (let move = 1; move <= 4; move += 1) {
    pointer(app, pixi, "pointermove", {
      x: from.x + ((to.x - from.x) * move) / 4,
      y: from.y + ((to.y - from.y) * move) / 4
    });
    frames(app, 1);
  }

  pointer(app, pixi, "pointerup", to);
  frames(app, 1);
  await tick();
  frames(app, 1);
}
