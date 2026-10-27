/**
 * @file ui plugin — the app of the anchor tests (F99). Not a test file. The board of "A Memory
 * Missing" cut down: an order strip (an x scroll of 306 u at 40, 1500 over a 696 u track of two
 * seats, 116 x 120 each), a fitted board (800 u drawn at 0.5 in a 400 u slot at 600, 200) with a
 * cell, and a world piece, a 64 u sprite centred at 500, 700. The tutorial screen holds the window,
 * an `<anchor>` whose targets a local `step` names, with a rim filling it and a button inside it;
 * a second anchor sits in a container fitted to 0.5. A third screen holds an anchor whose style
 * sets a size and a place. Real flow, world, text and Yoga; inert renderer, headless.
 */
import type { Log } from "@moku-labs/common/browser";
import { createApp, defineGame, projection, Shape, Sprite, Transform, type } from "../../../index";
import { animPlugin } from "../../anim";
import { assetsPlugin } from "../../assets";
import { i18nPlugin } from "../../i18n";
import { inputPlugin } from "../../input";
import { rendererPlugin } from "../../renderer";
import { scenesPlugin } from "../../scenes";
import { textPlugin } from "../../text";
import { worldPlugin } from "../../world";
import type { AnchorTarget } from "../../world/projection/types";
import { uiPlugin } from "../index";
import { defineComponent } from "../jsx/component";
import type { ElementMotion } from "../jsx/types";

/** How often the window played its `change.Box` motion. */
export const glides = { box: 0 };

/** The window's motion: every change of its targets glides it there over 300 ms, and is counted. */
const glide: ElementMotion = {
  change: {
    Box: view => {
      glides.box += 1;

      return view.toRest(Transform, { ms: 300 });
    }
  }
};

/** The first seat of the strip. */
export const SEAT0: AnchorTarget = { projection: "board.strip", key: "seat0" };

/** The second seat of the strip. */
export const SEAT1: AnchorTarget = { projection: "board.strip", key: "seat1" };

/** The cell of the fitted board. */
export const CELL: AnchorTarget = { projection: "board.strip", key: "cell" };

/** The world piece. */
export const PIECE: AnchorTarget = { projection: "board.pieces", key: "piece" };

/** A key no projection has. */
export const NOWHERE: AnchorTarget = { projection: "board.strip", key: "nowhere" };

/** The button inside the window: its own child. */
export const INNER: AnchorTarget = { projection: "tutorial", key: "inner" };

/** The window's targets for each step of the tutorial. */
const STEPS = {
  seat: SEAT0,
  seat1: SEAT1,
  cell: CELL,
  piece: PIECE,
  list: [SEAT0, CELL],
  listMissing: [NOWHERE, CELL],
  missing: NOWHERE,
  own: INNER
} as const;

/** A step of the tutorial. */
export type Step = keyof typeof STEPS;

/** The control buttons: one per step, and one that pads the window by 4. */
const CONTROLS: readonly Step[] = Object.keys(STEPS) as Step[];

/**
 * The tutorial: the window on the targets of its step, padded by `pad`, its rim half its height
 * and a note inside it once `thin`, and the controls at the bottom. The second window sits in a
 * container drawn at half its size, on the first seat, padded by 4.
 */
export const Tutorial = defineComponent("Tutorial", {
  local: { step: "seat" as Step, pad: 0, thin: false },
  view: (_props: object, local) => (
    <stack key="tutorialRoot" style={{ width: 1080, height: 1920 }}>
      <anchor key="window" to={STEPS[local.step]} pad={local.pad} motion={glide}>
        <stack key="rim" style={{ width: "100%", height: local.thin ? "50%" : "100%" }} />
        <button key="inner" intent="inner" style={{ width: 20, height: 20 }} />
        <stack
          key="mark"
          style={{ position: "absolute", left: 0, top: 0, width: 10, height: 10 }}
        />
        {local.thin ? <stack key="note" style={{ width: 30, height: 10 }} /> : undefined}
      </anchor>
      <stack key="half" style={{ width: 2160, height: 3840, fit: "contain" }}>
        <anchor key="halfWindow" to={SEAT0} pad={4}>
          <stack key="halfRim" style={{ width: "100%", height: "100%" }} />
        </anchor>
      </stack>
      <row key="controls" style={{ top: 1820, left: 0, width: 1080, height: 100 }}>
        {CONTROLS.map(step => (
          <button key={`go-${step}`} local={{ step }} style={{ width: 100, height: 100 }} />
        ))}
        <button key="go-pad" local={{ pad: 4 }} style={{ width: 100, height: 100 }} />
        <button key="go-thin" local={{ thin: true }} style={{ width: 100, height: 100 }} />
      </row>
    </stack>
  )
});

/** The board: the order strip and the fitted board. */
const boardStrip = projection({
  name: "board.strip",
  layer: "ui",
  from: () => ({ id: "board" }),
  view: () => (
    <stack key="boardRoot" style={{ width: 1080, height: 1920 }}>
      <scroll key="strip" axis="x" style={{ left: 40, top: 1500, width: 306, height: 120 }}>
        <row key="track" style={{ width: 696, height: 120 }}>
          <button key="seat0" intent="seat" style={{ width: 116, height: 120 }} />
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
    </stack>
  )
});

/** The world piece: a 64 u sprite centred on its `Transform`. */
const boardPieces = projection({
  name: "board.pieces",
  layer: "board",
  from: (): { id: string }[] => [{ id: "piece" }],
  key: (item: { id: string }) => item.id,
  view: () => [
    Sprite({ texture: "ui.coin", width: 64, height: 64, anchor: { x: 0.5, y: 0.5 } }),
    Transform({ x: 500, y: 700 })
  ]
});

/**
 * A screen whose anchor's style sets a size and a place, which its targets decide instead, and a
 * nine-slice it is drawn with; a square of 400 u fitted inside it.
 */
const styled = projection({
  name: "styled",
  layer: "ui",
  from: () => ({ id: "styled" }),
  view: () => (
    <stack key="styledRoot" style={{ width: 1080, height: 1920 }}>
      <anchor
        key="styledWindow"
        to={SEAT0}
        style={{ position: "absolute", left: 3, width: 500, height: 40, nineSlice: "ui.rim" }}
      >
        <stack key="styledRim" style={{ width: "100%", height: "100%" }} />
        <stack key="styledFit" style={{ width: 400, height: 400, fit: "contain" }} />
      </anchor>
    </stack>
  )
});

/** How often the root window's loop started. */
export const loops = { started: 0 };

/** The root window's loop: its alpha breathes forever, its pose is its rest's. */
const breathing: ElementMotion = {
  loop: view => {
    loops.started += 1;

    return view.tween(Shape, { alpha: 0.5 }, { ms: 300, repeat: "forever" });
  }
};

/** A screen whose root element is an anchor on the first seat, with a loop that never ends. */
const rootAnchor = projection({
  name: "rootAnchor",
  layer: "ui",
  from: () => ({ id: "rootAnchor" }),
  view: () => (
    <anchor key="rootWindow" to={SEAT0} motion={breathing}>
      <stack key="rootRim" style={{ width: "100%", height: "100%" }} />
    </anchor>
  )
});

/** The tutorial screen. */
const tutorial = projection({
  name: "tutorial",
  layer: "ui",
  from: () => ({ id: "tutorial" }),
  view: () => <Tutorial key="tutorialView" />
});

const { defineNode, defineFlow, defineFeature } = defineGame<{
  player: { visits: number };
  session: { visits: number };
  assets: string;
  strings: Record<string, never>;
}>();

const home = defineNode({ rest: true, outcomes: { seat: type(), cell: type(), inner: type() } });

const main = defineFlow("main", {
  nodes: { home },
  start: "home",
  outcomes: {},
  edges: { home: { seat: "home", cell: "home", inner: "home" } }
});

/** The feature of the anchor fixture. */
const anchorFeature = defineFeature("anchors", {
  flows: [main],
  projections: [boardStrip, boardPieces, tutorial, styled, rootAnchor],
  ui: [Tutorial]
});

/** Yields the microtask queue to the loop, the way a test waits without a timer. */
async function tick(times = 60): Promise<void> {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
}

/**
 * Builds the screen set plus `ui` with the fixture, not started yet.
 *
 * @returns The app, before `start()`.
 */
export function createAnchorApp() {
  glides.box = 0;
  loops.started = 0;

  return createApp({
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
      anchorFeature
    ],
    pluginConfigs: {
      flow: { mainFlow: main },
      i18n: { locale: "en", fallback: "en" },
      model: { initialPlayer: { visits: 0 }, initialSession: { visits: 0 }, seed: 1 }
    }
  });
}

/**
 * Lets the flow rest on `home`, sets the layers and runs one frame, with nothing mounted.
 *
 * @param app - The started app.
 */
export async function settleAnchorApp(app: ReturnType<typeof createAnchorApp>): Promise<void> {
  app.flow.run().catch(() => undefined);
  await tick();

  app.world.projection.setLayers([
    { name: "board", sort: "order" },
    { name: "ui", sort: "order" }
  ]);
  app.time.step(16);
}

/**
 * Starts the screen set plus `ui` headless, with nothing mounted.
 *
 * @returns The started app.
 */
export async function startAnchorApp() {
  const app = createAnchorApp();

  await app.start();
  await settleAnchorApp(app);

  return app;
}

/** The app `startAnchorApp` builds. */
export type AnchorApp = Awaited<ReturnType<typeof startAnchorApp>>;

/**
 * Steps frames of 16 ms.
 *
 * @param app - The running app.
 * @param count - How many.
 */
export function frames(app: AnchorApp, count: number): void {
  for (let frame = 0; frame < count; frame += 1) app.time.step(16);
}

/**
 * Mounts projections by hand, the way a scene mounts them, in draw order. No frame runs.
 *
 * @param app - The running app.
 * @param names - The projections.
 */
export function mount(app: AnchorApp, names: readonly string[]): void {
  app.world.projection.mount(names, { kind: "plugin", name: "test" });
}

/**
 * The entity of a keyed element or view, failing the test when it is not there.
 *
 * @param app - The running app.
 * @param target - Its projection and key.
 * @returns The entity.
 */
export function entityOf(app: AnchorApp, target: AnchorTarget): number {
  const entity = app.world.projection.entityOf(target.projection, target.key);

  if (entity === undefined) throw new Error(`no entity for "${target.key}"`);

  return entity;
}

/**
 * Taps a control of the tutorial and runs the frame that renders the new step.
 *
 * @param app - The running app.
 * @param key - The key of the control: `go-<step>` or `go-pad`.
 */
export function press(app: AnchorApp, key: string): void {
  app.input.tap(entityOf(app, { projection: "tutorial", key }));
  app.time.step(16);
}

/**
 * The payloads of every log entry of one event so far.
 *
 * @param app - The running app.
 * @param event - The event name.
 * @returns The payloads, in order.
 */
export function logged(app: AnchorApp, event: string): Array<Log.LogEntry["data"]> {
  return app.log
    .trace()
    .filter(entry => entry.event === event)
    .map(entry => entry.data);
}
