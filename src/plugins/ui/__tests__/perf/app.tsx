/**
 * @file ui plugin — the app of the perf tests and benches. Not a test file. Ten JSX roots at rest:
 * the board, a root of 200 elements drawn by one component whose view counts its runs; the inset,
 * a JSX projection laid out in a slot of the board; and eight small HUD roots. Three host elements
 * of the board name two world projections each, forty sprite views per projection. Real flow,
 * world, text and Yoga; inert renderer, headless.
 */
import { createApp, defineGame, projection, Sprite, Transform, type } from "../../../../index";
import { animPlugin } from "../../../anim";
import { assetsPlugin } from "../../../assets";
import { i18nPlugin } from "../../../i18n";
import type { CompiledMessages } from "../../../i18n/types";
import { inputPlugin } from "../../../input";
import { rendererPlugin } from "../../../renderer";
import { scenesPlugin } from "../../../scenes";
import { textPlugin } from "../../../text";
import { worldPlugin } from "../../../world";
import { uiPlugin } from "../../index";
import { defineComponent } from "../../jsx/component";

const { defineNode, defineFlow, defineFeature } = defineGame<{
  player: { coins: number };
  session: Record<string, never>;
  assets: string;
  strings: { "perf.title": Record<string, never> };
}>();

/** The one compiled locale of the fixture. */
const english: CompiledMessages = {
  "perf.title": () => [{ kind: "text", text: "Board" }]
};

/** How many times the board component's view ran: a reconcile of its root adds one. */
export const views = { board: 0 };

/** The world projections the three hosts of the board name, two each. */
export const PIECES: readonly string[] = [
  "pieces0",
  "pieces1",
  "pieces2",
  "pieces3",
  "pieces4",
  "pieces5"
];

/** Views per world projection. */
export const PIECE_VIEWS = 40;

/** List rows of the board: five elements each. */
const ROWS = 38;

/** The HUD roots beside the board and the inset. */
const HUDS = 8;

/** One view of a world projection. */
type Piece = { id: string; x: number };

/** One root of a single-root projection. */
type Item = { id: string };

/**
 * The views of one world projection: a sprite each, spread along a line.
 *
 * @returns The items.
 */
function pieces(): Piece[] {
  return Array.from({ length: PIECE_VIEWS }, (_unused, index) => ({ id: `p${index}`, x: index }));
}

/**
 * A world projection of sprites, drawn in the `board` layer unless a host names it.
 *
 * @param name - The projection name.
 * @returns The projection.
 */
function pieceProjection(name: string) {
  return projection({
    name,
    layer: "board",
    from: (): Piece[] => pieces(),
    key: (item: Piece) => item.id,
    view: (item: Piece) => [Sprite({ texture: "ui.coin" }), Transform({ x: item.x, y: 0 })]
  });
}

/**
 * One list row of the board: an icon, two texts and a button.
 *
 * @param index - The index of the row.
 * @returns The row.
 */
function listRow(index: number) {
  return (
    <row key={`r${index}`} style={{ height: 40, gap: 8 }}>
      <icon key={`i${index}`} name="ui.gear" style={{ width: 32, height: 32 }} />
      <text key={`n${index}`} style={{ width: 200, height: 32 }} content={`item ${index}`} />
      <text key={`c${index}`} style={{ width: 120, height: 32 }} content="cell" />
      <button
        key={`b${index}`}
        intent="tick"
        payload={{ index }}
        style={{ width: 120, height: 32, fill: 0x22_22_22 }}
      />
    </row>
  );
}

/**
 * The board: a header with the button the pointer presses, the three hosts and the slot of the
 * inset, then the list. Its pressed and hovered looks change the fill only: no rect and no pose
 * moves, so a press starts no motion and a window measures the restyle alone.
 */
export const Board = defineComponent("Board", {
  view: () => {
    views.board += 1;

    return (
      <column key="boardRoot" style={{ width: 1080, height: 1920, gap: 4 }}>
        <row key="head" style={{ height: 120, gap: 16, align: "center" }}>
          <button
            key="hot"
            intent="tick"
            style={{
              width: 160,
              height: 100,
              fill: 0x33_44_55,
              is: { hover: { fill: 0x55_66_77 }, pressed: { fill: 0x11_22_33 } }
            }}
          />
          <stack key="hostA" hosts={["pieces0", "pieces1"]} style={{ width: 100, height: 100 }} />
          <stack key="hostB" hosts={["pieces2", "pieces3"]} style={{ width: 100, height: 100 }} />
          <stack key="hostC" hosts={["pieces4", "pieces5"]} style={{ width: 100, height: 100 }} />
          <stack key="insetSlot" hosts={["inset"]} style={{ width: 200, height: 100 }} />
        </row>
        {Array.from({ length: ROWS }, (_unused, index) => listRow(index))}
      </column>
    );
  }
});

/** The board's projection: one root, the board component. */
const boardScreen = projection({
  name: "board",
  layer: "ui",
  from: (): Item => ({ id: "board" }),
  view: () => <Board key="boardView" />
});

/** The inset: a JSX projection laid out in the board's slot, so it pends at every solve. */
const insetScreen = projection({
  name: "inset",
  layer: "ui",
  from: (): Item => ({ id: "inset" }),
  view: () => (
    <row key="insetRoot" style={{ width: "100%", height: "100%" }}>
      <button key="insetButton" intent="tick" style={{ width: 80, height: 80 }} />
    </row>
  )
});

/** Eight small roots, one per item. */
const hudScreen = projection({
  name: "hud",
  layer: "ui",
  from: (): Item[] => Array.from({ length: HUDS }, (_unused, index) => ({ id: `h${index}` })),
  key: (item: Item) => item.id,
  view: (item: Item) => (
    <row key={`${item.id}Root`} style={{ width: 200, height: 60, gap: 8 }}>
      <text key={`${item.id}Label`} style={{ width: 120, height: 40 }} content={item.id} />
      <button key={`${item.id}Go`} intent="tick" style={{ width: 60, height: 40 }} />
    </row>
  )
});

const home = defineNode({ rest: true, outcomes: { tick: type() } });

const main = defineFlow("main", {
  nodes: { home },
  start: "home",
  outcomes: {},
  edges: { home: { tick: "home" } }
});

/** Every projection the fixture mounts. */
export const MOUNTED: readonly string[] = [...PIECES, "board", "inset", "hud"];

/** The feature of the fixture. */
const perfFeature = defineFeature("perf", {
  flows: [main],
  projections: [...PIECES.map(name => pieceProjection(name)), boardScreen, insetScreen, hudScreen],
  ui: [Board],
  strings: { en: english }
});

/**
 * Builds the screen set plus `ui` with the fixture, not started yet.
 *
 * @returns The app, before `start()`.
 */
export function createPerfApp() {
  views.board = 0;

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
      perfFeature
    ],
    pluginConfigs: {
      flow: { mainFlow: main },
      i18n: { locale: "en", fallback: "en" },
      model: { initialPlayer: { coins: 0 }, initialSession: {}, seed: 1 }
    }
  });
}

/** The app `createPerfApp` builds. */
export type PerfApp = ReturnType<typeof createPerfApp>;

/** Frames that bring every enter motion of the fixture to rest. */
const SETTLE_FRAMES = 60;

/**
 * Lets the flow rest on `home`, mounts every projection of the fixture, and runs frames until
 * the screen rests.
 *
 * @param app - The started app.
 */
export async function settlePerfApp(app: PerfApp): Promise<void> {
  app.flow.run().catch(() => undefined);

  for (let index = 0; index < 60; index += 1) await Promise.resolve();

  app.world.projection.setLayers([
    { name: "board", sort: "order" },
    { name: "ui", sort: "order" }
  ]);
  app.world.projection.mount(MOUNTED, { kind: "plugin", name: "perf" });

  for (let frame = 0; frame < SETTLE_FRAMES; frame += 1) app.time.step(16);
}
