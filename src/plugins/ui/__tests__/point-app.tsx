/**
 * @file ui plugin — the app of the point tests (F101, F102). Not a test file. A board with a dot,
 * an element of no area at 300, 400, and a slab of 100 x 60 at 600, 400. A screen holds an
 * `<anchor>` on the dot or the slab, as a local `on` names, that glides on a change of target and
 * holds a 40 u button `hand` overflowing it; a second anchor on the slab padded inward by 60, more
 * than half the slab; and an image at 100, 1000 whose size a local names. Drawn on the fake page
 * and the fake Pixi, so a press is a pointer event that goes through the hit test. Real flow,
 * world, text and Yoga.
 */
import { createApp, defineGame, projection, Transform, type } from "../../../index";
import { animPlugin } from "../../anim";
import { assetsPlugin } from "../../assets";
import { i18nPlugin } from "../../i18n";
import { inputPlugin } from "../../input";
import { rendererPlugin } from "../../renderer";
import { installFakeDom } from "../../renderer/__tests__/fake-dom";
import { createFakePixi, type FakePixi, FakeTexture } from "../../renderer/__tests__/fake-pixi";
import { scenesPlugin } from "../../scenes";
import { textPlugin } from "../../text";
import { worldPlugin } from "../../world";
import type { AnchorTarget } from "../../world/projection/types";
import { uiPlugin } from "../index";
import { defineComponent } from "../jsx/component";
import type { ElementMotion } from "../jsx/types";

/** How often the marker played its `change.Box` motion. */
export const glides = { box: 0 };

/** The marker's motion: every change of its target glides it there over 300 ms, and is counted. */
const glide: ElementMotion = {
  change: {
    Box: view => {
      glides.box += 1;

      return view.toRest(Transform, { ms: 300 });
    }
  }
};

/** The dot: an element of no area at 300, 400. */
export const DOT: AnchorTarget = { projection: "point.board", key: "dot" };

/** The slab: an element of 100 x 60 at 600, 400. */
export const SLAB: AnchorTarget = { projection: "point.board", key: "slab" };

/** The targets the marker can stand on. */
const TARGETS = { dot: DOT, slab: SLAB } as const;

/** The sizes the image is laid out at. */
const PICTURES = {
  full: { width: 40, height: 40 },
  thin: { width: 0, height: 40 },
  flat: { width: 40, height: 0 }
} as const;

/**
 * The screen: the marker on its target with the hand inside it, the squeezed anchor on the slab,
 * the image, and the controls at the bottom.
 */
export const Marker = defineComponent("Marker", {
  local: { on: "dot" as keyof typeof TARGETS, picture: "full" as keyof typeof PICTURES },
  view: (_props: object, local) => (
    <stack key="markerRoot" style={{ width: 1080, height: 1920 }}>
      <anchor key="marker" to={TARGETS[local.on]} motion={glide}>
        <button key="hand" intent="hand" style={{ width: 40, height: 40 }} />
      </anchor>
      <anchor key="squeezed" to={SLAB} pad={-60} />
      <image
        key="picture"
        texture="ui.coin"
        style={{
          position: "absolute",
          left: 100,
          top: 1000,
          reason: "picture",
          ...PICTURES[local.picture]
        }}
      />
      <row
        key="controls"
        style={{ position: "absolute", left: 0, top: 1820, width: 1080, reason: "controls" }}
      >
        <button key="go-dot" local={{ on: "dot" }} style={{ width: 100, height: 100 }} />
        <button key="go-slab" local={{ on: "slab" }} style={{ width: 100, height: 100 }} />
        <button key="go-thin" local={{ picture: "thin" }} style={{ width: 100, height: 100 }} />
        <button key="go-flat" local={{ picture: "flat" }} style={{ width: 100, height: 100 }} />
        <button key="go-full" local={{ picture: "full" }} style={{ width: 100, height: 100 }} />
      </row>
    </stack>
  )
});

/** The board: the dot and the slab. */
const board = projection({
  name: "point.board",
  layer: "ui",
  from: () => ({ id: "board" }),
  view: () => (
    <stack key="pointBoard" style={{ width: 1080, height: 1920 }}>
      <stack
        key="dot"
        style={{ position: "absolute", left: 300, top: 400, width: 0, height: 0, reason: "dot" }}
      />
      <stack
        key="slab"
        style={{
          position: "absolute",
          left: 600,
          top: 400,
          width: 100,
          height: 60,
          reason: "slab"
        }}
      />
    </stack>
  )
});

/** The screen of the marker. */
const screen = projection({
  name: "point.screen",
  layer: "ui",
  from: () => ({ id: "screen" }),
  view: () => <Marker key="markerView" />
});

const { defineNode, defineFlow, defineFeature } = defineGame<{
  player: { visits: number };
  session: { visits: number };
  assets: string;
  strings: Record<string, never>;
}>();

const home = defineNode({ rest: true, outcomes: { hand: type() } });

const main = defineFlow("main", {
  nodes: { home },
  start: "home",
  outcomes: {},
  edges: { home: { hand: "home" } }
});

/** The feature of the point fixture. */
const pointFeature = defineFeature("points", {
  flows: [main],
  projections: [board, screen],
  ui: [Marker]
});

/** Yields the microtask queue to the loop, the way a test waits without a timer. */
async function tick(times = 60): Promise<void> {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
}

/**
 * Builds the point app on the fake page and the fake Pixi, not started yet.
 *
 * @returns The app and its fake Pixi.
 */
function createPointApp() {
  glides.box = 0;
  installFakeDom({ width: 1080, height: 1920 });

  const pixi = createFakePixi();
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
      pointFeature
    ],
    pluginConfigs: {
      flow: { mainFlow: main },
      i18n: { locale: "en", fallback: "en" },
      model: { initialPlayer: { visits: 0 }, initialSession: { visits: 0 }, seed: 1 },
      // The warm-up probes are left out: the fake Pixi has no render texture to draw them into.
      renderer: { mount: "#game", loadPixi: () => Promise.resolve(pixi.module), warm: 0 }
    }
  });

  return { app, pixi };
}

/** The app `createPointApp` builds. */
export type PointApp = ReturnType<typeof createPointApp>["app"];

/**
 * Steps frames of 16 ms.
 *
 * @param app - The running app.
 * @param count - How many.
 */
export function frames(app: PointApp, count: number): void {
  for (let frame = 0; frame < count; frame += 1) app.time.step(16);
}

/**
 * Starts the point app drawn: every texture a 64 u square, the flow resting on `home`, the board
 * and the screen mounted, two frames run.
 *
 * @returns The started app and its fake Pixi.
 */
export async function startPointApp(): Promise<{ app: PointApp; pixi: FakePixi }> {
  const started = createPointApp();
  const { app } = started;

  await app.start();
  app.renderer.sync.textures.provide(() => new FakeTexture({}) as never);
  app.flow.run().catch(() => undefined);
  await tick();
  app.world.projection.setLayers([{ name: "ui", sort: "order" }]);
  app.world.projection.mount(["point.board", "point.screen"], { kind: "plugin", name: "test" });
  frames(app, 2);

  return started;
}

/**
 * The entity of a keyed element, failing the test when it is not there.
 *
 * @param app - The running app.
 * @param target - Its projection and key.
 * @returns The entity.
 */
export function entityOf(app: PointApp, target: AnchorTarget): number {
  const entity = app.world.projection.entityOf(target.projection, target.key);

  if (entity === undefined) throw new Error(`no entity for "${target.key}"`);

  return entity;
}

/**
 * Taps a control of the screen and runs the frame that renders what it changed.
 *
 * @param app - The running app.
 * @param key - The key of the control: `go-dot`, `go-slab`, `go-thin`, `go-flat` or `go-full`.
 */
export function press(app: PointApp, key: string): void {
  app.input.tap(entityOf(app, { projection: "point.screen", key }));
  app.time.step(16);
}

/**
 * Dispatches one pointer event of the first touch on the fake canvas, at a point in reference
 * units.
 *
 * @param app - The running app.
 * @param pixi - Its fake Pixi.
 * @param name - The DOM event name.
 * @param point - Where, in reference units.
 * @param point.x - Its x.
 * @param point.y - Its y.
 */
function pointer(app: PointApp, pixi: FakePixi, name: string, point: { x: number; y: number }) {
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
 * @param app - The running app.
 * @param pixi - Its fake Pixi.
 * @param point - Where, in reference units.
 * @param point.x - Its x.
 * @param point.y - Its y.
 */
export async function tapAt(
  app: PointApp,
  pixi: FakePixi,
  point: { x: number; y: number }
): Promise<void> {
  pointer(app, pixi, "pointerdown", point);
  frames(app, 1);
  pointer(app, pixi, "pointerup", point);
  frames(app, 1);
  await tick();
  frames(app, 1);
}
