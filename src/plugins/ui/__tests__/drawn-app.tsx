/**
 * @file ui plugin — the drawn harness of the ui integration tests. Not a test file. The screen set
 * runs on the fake DOM and the fake Pixi of the renderer's own tests, so `sync` builds a real
 * display tree, the layers are real containers and the hit test walks what is drawn. A press and
 * a drag are pointer events on the fake canvas, which `input` listens to.
 *
 * Two scenes and a popup. `ward`: the JSX root `wardScene` in layer `scene` (a slot `pan` that
 * hosts the world projection `ward.pan` over its own child `panFrame`, a panel at `zIndex` 0, a
 * child stack with the door, and a badge at `zIndex: 10`) and the `ui` root `wardHud`, whose shop
 * button lies exactly over the door. `board`: the JSX root `boardBack`, whose child `field` hosts
 * `board.cells` (drop targets) and `board.items` (draggable), the JSX projection `board.badge`
 * keyed by the cell of the item, and the JSX projection `orders.row` over it. The popup `Shop`
 * opens from the ward and over the board. `order.overlap`, mounted by hand, holds two overlapping
 * buttons, the first one shown by a local flag; `drawn.shelf`, mounted by hand, an x scroll with a
 * shop button inside a y scroll.
 *
 * The app draws on the fake Pixi, or on the real one with a stand-in GPU (`startDrawnApp({ stage })`),
 * where the tree oracle of the renderer's tests can read every frame the helpers step.
 */
import {
  createApp,
  Draggable,
  DropTarget,
  defineGame,
  defineScene,
  projection,
  Sprite,
  screen,
  Transform,
  type
} from "../../../index";
import type { Manifest } from "../../assets/types";
import type { CompiledMessages } from "../../i18n/types";
import { type FakeDom, type FakeElement, installFakeDom } from "../../renderer/__tests__/fake-dom";
import { createFakePixi, type FakePixi, FakeTexture } from "../../renderer/__tests__/fake-pixi";
import type { StagePixi } from "../../renderer/__tests__/stage-pixi";
import type { Entity } from "../../world/types";
import { popup } from "../components";
import { defineComponent } from "../jsx/component";

/** The player of the drawn fixture: the cells of the board and the items on them. */
export type DrawnPlayer = {
  cells: Array<{ id: string; x: number }>;
  items: Array<{ id: string; cell: string }>;
};

const { defineNode, defineFlow, defineFeature } = defineGame<{
  player: DrawnPlayer;
  session: { visits: number };
  assets: string;
  strings: { "drawn.title": Record<string, never> };
}>();

/** The manifest of the fixture: the two scene bundles, with no files to fetch. */
const manifest: Manifest = {
  version: 2,
  bundles: {
    ward: { feature: "drawn", tier: "lazy", mb: 0, files: [] },
    board: { feature: "drawn", tier: "lazy", mb: 0, files: [] }
  }
};

/** The one compiled locale of the fixture. */
const english: CompiledMessages = {
  "drawn.title": () => [{ kind: "text", text: "drawn" }]
};

/** The x of every cell of the board, in the field's own units. */
const CELL_X: Readonly<Record<string, number>> = { c1: 150, c2: 450 };

/** The shop popup: a panel with a close button. */
export const Shop = defineComponent("Shop", {
  outcomes: { close: type() },
  view: () => (
    <panel key="shopPanel" style={{ width: 600, height: 600 }}>
      <button key="shopClose" intent="close" escape style={{ width: 100, height: 100 }} />
    </panel>
  )
});

/** One pan of the ward, a world sprite hosted in the scene's slot. */
type Pan = { id: string };

/** The ward's pan: one sprite, drawn in the `scene` layer unless the slot hosts it. */
export const wardPan = projection({
  name: "ward.pan",
  layer: "scene",
  from: (): Pan[] => [{ id: "pan" }],
  key: (item: Pan) => item.id,
  view: () => [
    Sprite({ texture: "ward.pan", width: 200, height: 200 }),
    Transform({ x: 300, y: 300 })
  ]
});

/** One row of a single-root screen. */
type ScreenItem = { id: string };

/**
 * The scene of the ward, a JSX root in layer `scene`, as A Memory Missing's `location.scene` is.
 * The door, 400 × 200 at (0, 1200), lies under the hud's shop button.
 */
export const wardScene = projection({
  name: "ward.scene",
  layer: "scene",
  from: (): ScreenItem => ({ id: "wardScene" }),
  view: () => (
    <stack key="wardScene" style={{ width: 1080, height: 1920 }}>
      <stack
        key="pan"
        hosts={["ward.pan"]}
        style={{ position: "absolute", top: 0, left: 0, width: 1080, height: 1080, reason: "pan" }}
      >
        <panel key="panFrame" style={{ width: 1080, height: 1080 }} />
      </stack>
      <column
        key="wardStack"
        style={{
          position: "absolute",
          top: 1200,
          left: 0,
          width: 1080,
          height: 400,
          reason: "door"
        }}
      >
        <button key="wardDoor" intent="board" style={{ width: 400, height: 200 }} />
      </column>
      <button
        key="wardBadge"
        intent="shop"
        style={{
          position: "absolute",
          top: 1600,
          left: 800,
          width: 200,
          height: 200,
          zIndex: 10,
          reason: "badge"
        }}
      />
    </stack>
  )
});

/** The hud of the ward, a JSX root in layer `ui`: its shop button covers the scene's door. */
export const wardHud = projection({
  name: "ward.hud",
  layer: "ui",
  from: (): ScreenItem => ({ id: "wardHud" }),
  view: () => (
    <stack key="wardHud" style={{ width: 1080, height: 1920 }}>
      <button
        key="hudShop"
        intent="shop"
        style={{ position: "absolute", top: 1200, left: 0, width: 400, height: 200, reason: "hud" }}
      />
    </stack>
  )
});

/** The cells of the board: drop targets hosted in the field. */
export const boardCells = projection({
  name: "board.cells",
  layer: "cells",
  from: (player: DrawnPlayer) => player.cells,
  key: (cell: { id: string }) => cell.id,
  view: (cell: { id: string; x: number }) => [
    Sprite({ texture: "board.cell", width: 200, height: 200 }),
    Transform({ x: cell.x, y: 300 }),
    DropTarget({ intent: "drop", payload: { cell: cell.id } })
  ]
});

/** The items of the board: draggable sprites on their cells, hosted in the field. */
export const boardItems = projection({
  name: "board.items",
  layer: "items",
  lift: "lifted",
  from: (player: DrawnPlayer) => player.items,
  key: (item: { id: string }) => item.id,
  view: (item: { id: string; cell: string }) => [
    Sprite({ texture: "board.item", width: 120, height: 120 }),
    Transform({ x: CELL_X[item.cell] ?? 0, y: 300 }),
    Draggable({ payload: { item: item.id } })
  ]
});

/** The back of the board, a JSX root whose field hosts the cells and the items. */
export const boardBack = projection({
  name: "board.back",
  layer: "cells",
  from: (): ScreenItem => ({ id: "boardBack" }),
  view: () => (
    <column key="boardBack" style={{ width: 1080, height: 1920 }}>
      <stack
        key="field"
        hosts={["board.cells", "board.items"]}
        style={{ width: 600, height: 600 }}
      />
      <button key="boardBackButton" intent="back" style={{ width: 200, height: 100 }} />
    </column>
  )
});

/** A row of orders, a JSX projection of the board. */
export const ordersRow = projection({
  name: "orders.row",
  layer: "ui",
  from: (): ScreenItem => ({ id: "ordersRow" }),
  view: () => (
    <row
      key="ordersRow"
      style={{ position: "absolute", top: 1700, left: 0, width: 1080, height: 200, reason: "row" }}
    />
  )
});

/** A badge on the cell of the first item, a JSX root keyed by that cell: a move remounts it. */
export const boardBadge = projection({
  name: "board.badge",
  layer: "ui",
  from: (player: DrawnPlayer): ScreenItem[] => [{ id: player.items[0]?.cell ?? "none" }],
  key: (badge: ScreenItem) => badge.id,
  view: () => (
    <stack
      key="badge"
      style={{ position: "absolute", top: 1650, left: 0, width: 400, height: 200, reason: "badge" }}
    />
  )
});

/**
 * Two overlapping buttons, `first` shown while the local flag says so, and the two buttons that
 * flip the flag.
 */
export const Overlap = defineComponent("Overlap", {
  local: { shown: true },
  view: (_props: object, local) => (
    <stack key="overlapRoot" style={{ width: 1080, height: 1920 }}>
      {local.shown ? (
        <button
          key="first"
          intent="first"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: 400,
            height: 400,
            reason: "first"
          }}
        />
      ) : undefined}
      <button
        key="second"
        intent="second"
        style={{
          position: "absolute",
          top: 200,
          left: 200,
          width: 400,
          height: 400,
          reason: "second"
        }}
      />
      <button
        key="hideFirst"
        local={{ shown: false }}
        style={{
          position: "absolute",
          top: 1400,
          left: 600,
          width: 200,
          height: 200,
          reason: "hide"
        }}
      />
      <button
        key="showFirst"
        local={{ shown: true }}
        style={{
          position: "absolute",
          top: 1600,
          left: 600,
          width: 200,
          height: 200,
          reason: "show"
        }}
      />
    </stack>
  )
});

/** The screen of the overlapping buttons, mounted by hand: no scene names it. */
export const overlapScreen = projection({
  name: "order.overlap",
  layer: "ui",
  from: (): ScreenItem => ({ id: "overlap" }),
  view: () => <Overlap key="overlap" />
});

/**
 * A page with a shelf in it, mounted by hand: a y scroll of 600 u at (0, 100) whose first child
 * is an x scroll of 600 × 200 over a 1200 u track. The first tile of the track, 200 × 200 at
 * (0, 100), is a button that opens the shop.
 */
export const shelfScreen = projection({
  name: "drawn.shelf",
  layer: "ui",
  from: (): ScreenItem => ({ id: "shelf" }),
  view: () => (
    <stack key="shelfRoot" style={{ width: 1080, height: 1920 }}>
      <scroll
        key="shelfPage"
        style={{
          position: "absolute",
          top: 100,
          left: 0,
          width: 1080,
          height: 600,
          reason: "page"
        }}
      >
        <column key="shelfPageBody" style={{ width: 1080, height: 1200 }}>
          <scroll key="shelf" axis="x" style={{ width: 600, height: 200 }}>
            <row key="shelfTrack" style={{ width: 1200, height: 200 }}>
              <button key="shelfBuy" intent="shop" style={{ width: 200, height: 200 }} />
            </row>
          </scroll>
        </column>
      </scroll>
    </stack>
  )
});

/** The ward. The hud is listed first: only the layers put the scene root under it. */
export const wardSceneDef = defineScene("ward", {
  bundle: "ward",
  layers: { scene: {} },
  projections: [wardHud, wardScene, wardPan]
});

/** The board. */
export const boardSceneDef = defineScene("board", {
  bundle: "board",
  layers: { cells: {}, items: {}, lifted: {} },
  projections: [boardBack, boardCells, boardItems, boardBadge, ordersRow]
});

const ward = defineNode({
  rest: true,
  scene: "ward",
  outcomes: { board: type(), shop: type() }
});

const shop = defineNode({
  outcomes: { close: type() },
  run: async ({ fx, out }) => {
    await fx(popup(Shop, {}));

    return out.close();
  }
});

const board = defineNode({
  rest: true,
  scene: "board",
  outcomes: { drop: type<{ item: string; cell: string }>(), back: type(), shop: type() }
});

const boardShop = defineNode({
  outcomes: { close: type() },
  run: async ({ fx, out }) => {
    await fx(popup(Shop, {}));

    return out.close();
  }
});

const move = defineNode({
  input: type<{ item: string; cell: string }>(),
  outcomes: { done: type() },
  run: ({ input, player, out }) => {
    const item = player.items.find(entry => entry.id === input.item);

    if (item !== undefined) item.cell = input.cell;

    return out.done();
  }
});

const main = defineFlow("main", {
  nodes: { ward, shop, board, boardShop, move },
  start: "ward",
  outcomes: {},
  edges: {
    ward: { board: "board", shop: "shop" },
    shop: { close: "ward" },
    board: { drop: "move", back: "ward", shop: "boardShop" },
    boardShop: { close: "board" },
    move: { done: "board" }
  }
});

/** The feature of the drawn fixture. */
export const drawnFeature = defineFeature("drawn", {
  flows: [main],
  scenes: [wardSceneDef, boardSceneDef],
  projections: [
    wardPan,
    wardScene,
    wardHud,
    boardCells,
    boardItems,
    boardBack,
    boardBadge,
    ordersRow,
    overlapScreen,
    shelfScreen
  ],
  ui: [Shop, Overlap],
  strings: { en: english }
});

/**
 * Yields the microtask queue to the loop, the way a test waits without a timer.
 *
 * @param times - How many turns to give it.
 */
export async function tick(times = 80): Promise<void> {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
}

/** What the app draws on: the fake Pixi, or the real one with a stand-in GPU; a press goes to its canvas. */
export type DrawnPixi = { last(): { canvas: FakeElement } };

/** How a test starts the drawn app. */
export type DrawnOptions = {
  /** The real Pixi with a stand-in GPU, drawn on demand, instead of the fake one. */
  stage?: StagePixi;
  /** The texture every key answers; a fake texture when left out. */
  texture?: () => unknown;
};

/** What runs after every frame the helpers step, by app: the tree oracle's check. */
const afterFrames = new WeakMap<object, () => void>();

/**
 * Calls a check after every frame the helpers of this file step for one app.
 *
 * @param app - The running app.
 * @param check - What to call: the tree oracle's `check`.
 */
export function afterEachFrame(app: object, check: () => void): void {
  afterFrames.set(app, check);
}

/**
 * Steps one frame of 16 ms, then the check of `afterEachFrame`.
 *
 * @param app - The running app.
 * @param app.time - Its time plugin.
 * @param app.time.step - Steps one frame.
 */
export function step(app: { time: { step(deltaMs: number): void } }): void {
  app.time.step(16);
  afterFrames.get(app)?.();
}

/**
 * Starts the screen set plus the drawn feature on the fake page, with the flow resting on `ward`
 * and the ward drawn. The fake page stubs globals: the test takes them down with
 * `vi.unstubAllGlobals()` after each case.
 *
 * @param options - The real Pixi and its texture, for a test the tree oracle watches.
 * @returns The started app, its page and its Pixi.
 */
export async function startDrawnApp(options: DrawnOptions = {}) {
  const dom: FakeDom = installFakeDom({ width: 1080, height: 1920 });
  const pixi: FakePixi | StagePixi = options.stage ?? createFakePixi();
  const drawing = options.stage === undefined ? {} : { onDemand: true, warm: 0 };
  const app = createApp({
    plugins: [...screen, drawnFeature],
    pluginConfigs: {
      assets: { manifest },
      flow: { mainFlow: main },
      i18n: { locale: "en", fallback: "en" },
      model: {
        initialPlayer: {
          cells: [
            { id: "c1", x: CELL_X.c1 ?? 0 },
            { id: "c2", x: CELL_X.c2 ?? 0 }
          ],
          items: [{ id: "i1", cell: "c1" }]
        },
        initialSession: { visits: 0 },
        seed: 1
      },
      renderer: { mount: "#game", loadPixi: () => Promise.resolve(pixi.module), ...drawing }
    }
  });

  await app.start();
  app.renderer.sync.textures.provide(() => (options.texture?.() ?? new FakeTexture({})) as never);
  app.flow.run().catch(() => undefined);
  await settle(app, 4);

  return { app, dom, pixi };
}

/** The app `startDrawnApp` builds. */
export type DrawnApp = Awaited<ReturnType<typeof startDrawnApp>>["app"];

/**
 * Lets the runner move, then runs frames, so the next node is entered and the screen follows.
 *
 * @param app - The running app.
 * @param frames - How many frames to step after the runner moved.
 */
export async function settle(app: DrawnApp, frames = 3): Promise<void> {
  await tick();

  for (let frame = 0; frame < frames; frame += 1) step(app);

  await tick();
}

/** A point in reference units. */
export type DrawnPoint = { x: number; y: number };

/**
 * Dispatches one pointer event of the first touch on the canvas, at a point in reference units.
 *
 * @param app - The running app.
 * @param pixi - Its Pixi, whose canvas `input` listens to.
 * @param name - The DOM event name.
 * @param point - Where, in reference units.
 */
export function pointer(app: DrawnApp, pixi: DrawnPixi, name: string, point: DrawnPoint): void {
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
 * @param pixi - Its Pixi.
 * @param point - Where, in reference units.
 */
export async function press(app: DrawnApp, pixi: DrawnPixi, point: DrawnPoint): Promise<void> {
  pointer(app, pixi, "pointerdown", point);
  step(app);
  pointer(app, pixi, "pointerup", point);
  step(app);
  await settle(app, 1);
}

/**
 * A drag from one point to another in four steps, a frame after each, then the release.
 *
 * @param app - The running app.
 * @param pixi - Its Pixi.
 * @param from - Where the finger goes down, in reference units.
 * @param to - Where it is lifted, in reference units.
 */
export async function drag(
  app: DrawnApp,
  pixi: DrawnPixi,
  from: DrawnPoint,
  to: DrawnPoint
): Promise<void> {
  pointer(app, pixi, "pointerdown", from);
  step(app);

  for (let move = 1; move <= 4; move += 1) {
    const at = {
      x: from.x + ((to.x - from.x) * move) / 4,
      y: from.y + ((to.y - from.y) * move) / 4
    };

    pointer(app, pixi, "pointermove", at);
    step(app);
  }

  pointer(app, pixi, "pointerup", to);
  step(app);
  await settle(app, 1);
}

/**
 * The centre of the box a view is drawn and hit in, in reference units.
 *
 * @param app - The running app.
 * @param entity - The drawn entity.
 * @returns The centre, or `undefined` when the view is not drawn.
 */
export function pointOf(app: DrawnApp, entity: Entity): DrawnPoint | undefined {
  const box = app.renderer.sync.boundsOf(entity);

  if (box === undefined) return undefined;

  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}
