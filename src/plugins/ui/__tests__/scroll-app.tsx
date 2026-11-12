/**
 * @file ui plugin — the app of the scroll tests (change 2026-10-19-horizontal-scroll): the order
 * strip of A Memory Missing's board (a 306 u window over a 696 u track, stops 0, 318 and 390,
 * opened on 318, and the pinned column that closes to a 390 u window with stops 0 and 306), a
 * free strip with no stops, a vertical list, a windowed list, an x strip inside a y list, a
 * windowed list on the x axis, a scroll whose axis changes, a strip opened on 318 whose track
 * starts too short for it and grows, a strip whose track and offset shift in one render, and the
 * glide strip and windowed glide list a test renders again with any `offset`, `glideMs`, `aim`
 * and `jump` (change 2026-11-12-scroll-glide-control). The finger lands the way `input` lands it: `Pressed` on the
 * scroll and the `Pointer` resource. Real flow runner, plain Bun, inert
 * renderer, real Yoga.
 */
import type { Log } from "@moku-labs/common/browser";
import { createApp, defineGame, projection, type } from "../../../index";
import { animPlugin } from "../../anim";
import { assetsPlugin } from "../../assets";
import { i18nPlugin } from "../../i18n";
import { inputPlugin } from "../../input";
import { Pointer, Pressed } from "../../input/components";
import { rendererPlugin } from "../../renderer";
import { Parent, Transform } from "../../renderer/components";
import { scenesPlugin } from "../../scenes";
import { textPlugin } from "../../text";
import { worldPlugin } from "../../world";
import { Tree } from "../../world/ecs/define";
import { ScrollState, type ScrollStateValue } from "../components";
import { uiPlugin } from "../index";
import { defineComponent } from "../jsx/component";
import type { DescriptionNode } from "../jsx/types";

/** The track of the order strip, in reference units. */
export const TRACK = 696;

/** The window of the strip while the pinned column stands. */
export const PINNED = 306;

/** The window of the strip once the pinned column closed. */
export const OPEN = 390;

/** The stops of the strip while the pinned column stands: the events, the orders, the end. */
const PINNED_STOPS = [0, 318, 390];

/** The stops of the strip once the pinned column closed. */
const OPEN_STOPS = [0, 306];

/** The track of the growing strip before it grows: 200 u past its window. */
const SHORT_TRACK = PINNED + 200;

/** The track of the growing strip after its second growth: 690 u past its window. */
export const LONG_TRACK = TRACK + 300;

/** The track of the free strip: it scrolls 2694 u. */
export const FREE_TRACK = 3000;

/** The height of a row of the lists. */
export const ROW = 80;

/** The rows of the vertical list: 30 of 80 u in a 200 u list scroll 2200 u. */
const LIST_ROWS = 30;

/** The rows of the windowed list. */
export const WINDOW_ROWS = 1000;

/** The height of the windowed list. */
export const WINDOW = 1600;

const rootStyle = { width: 1080, height: 1920 } as const;
const tileStyle = { width: 116, height: 120 } as const;
const controlStyle = { width: 120, height: 100 } as const;

/**
 * The board's order strip and the controls that change what it is told: `unpin` closes the
 * pinned column (a 390 u window, stops 0 and 306, offset 306, all in one render), `widen` widens
 * the window alone, `toEvents` sets the offset prop to 0, `restyle` gives the strip another
 * height and the same offset prop.
 */
export const StripScreen = defineComponent("StripScreen", {
  local: { pinned: true, wide: false, at: 318, tall: false },
  view: (_props: object, local) => (
    <column key="stripRoot" style={rootStyle}>
      <scroll
        key="strip"
        axis="x"
        snap={local.pinned ? PINNED_STOPS : OPEN_STOPS}
        offset={local.at}
        style={{
          width: local.pinned && !local.wide ? PINNED : OPEN,
          height: local.tall ? 140 : 120
        }}
      >
        <row key="track" style={{ width: TRACK, height: 120 }}>
          <button key="event1" intent="event" style={tileStyle} />
          <button key="order1" intent="order" style={tileStyle} />
        </row>
      </scroll>
      <row key="controls" style={{ width: 1080, height: 100 }}>
        <button key="unpin" local={{ pinned: false, at: 306 }} style={controlStyle} />
        <button key="widen" local={{ wide: true }} style={controlStyle} />
        <button key="toEvents" local={{ at: 0 }} style={controlStyle} />
        <button key="restyle" local={{ tall: true }} style={controlStyle} />
      </row>
    </column>
  )
});

/** The width of the tile that comes in at the start of the jump strip's track. */
export const EARLY_TILE = 82;

/**
 * The order strip of F141 (`jump` on `scroll`), opened on 0 with no stops: `shift` brings a first
 * tile of 82 u at the start of the track and the offset 82 with `jump` in one render, the place of
 * the cards kept; `shiftGlide` brings the same tile and offset without `jump`; `toOrders` sets the
 * offset prop to 318, a glide.
 */
export const JumpScreen = defineComponent("JumpScreen", {
  local: { early: false, at: 0, jump: false },
  view: (_props: object, local) => (
    <column key="jumpRoot" style={rootStyle}>
      <scroll
        key="jumping"
        axis="x"
        offset={local.at}
        jump={local.jump}
        style={{ width: PINNED, height: 120 }}
      >
        <row key="jumpTrack" style={{ width: TRACK + (local.early ? EARLY_TILE : 0), height: 120 }}>
          {local.early ? (
            <button key="earlyTile" intent="event" style={{ width: EARLY_TILE, height: 120 }} />
          ) : undefined}
          <button key="jumpEvent" intent="event" style={tileStyle} />
          <button key="jumpOrder" intent="order" style={tileStyle} />
        </row>
      </scroll>
      <row key="jumpControls" style={{ width: 1080, height: 100 }}>
        <button
          key="shift"
          local={{ early: true, at: EARLY_TILE, jump: true }}
          style={controlStyle}
        />
        <button key="shiftGlide" local={{ early: true, at: EARLY_TILE }} style={controlStyle} />
        <button key="toOrders" local={{ at: 318 }} style={controlStyle} />
      </row>
    </column>
  )
});

/**
 * A scroll whose axis a local flag turns from `x` to `y`, and a second control that renders it
 * again with the turned axis.
 */
export const TurnScreen = defineComponent("TurnScreen", {
  local: { turned: false, tall: false },
  view: (_props: object, local) => (
    <column key="turnRoot" style={rootStyle}>
      <scroll
        key="turning"
        axis={local.turned ? "y" : "x"}
        style={{ width: PINNED, height: local.tall ? 140 : 120 }}
      >
        <row key="turnTrack" style={{ width: TRACK, height: 120 }} />
      </scroll>
      <button key="turn" local={{ turned: true }} style={controlStyle} />
      <button key="nudge" local={{ tall: true }} style={controlStyle} />
    </column>
  )
});

/**
 * A strip opened on `offset={318}` whose track first runs only 200 u past its window, the way a
 * text runs short before its font arrives: `grow` gives it the board's track (`max` 390),
 * `growMore` a longer one (`max` 690), `farther` sets the offset prop to 600.
 */
export const GrowScreen = defineComponent("GrowScreen", {
  local: { track: SHORT_TRACK, at: 318 },
  view: (_props: object, local) => (
    <column key="growRoot" style={rootStyle}>
      <scroll key="growing" axis="x" offset={local.at} style={{ width: PINNED, height: 120 }}>
        <row key="growTrack" style={{ width: local.track, height: 120 }} />
      </scroll>
      <row key="growControls" style={{ width: 1080, height: 100 }}>
        <button key="grow" local={{ track: TRACK }} style={controlStyle} />
        <button key="growMore" local={{ track: LONG_TRACK }} style={controlStyle} />
        <button key="farther" local={{ at: 600 }} style={controlStyle} />
      </row>
    </column>
  )
});

/**
 * What a render tells the glide strip (change 2026-11-12-scroll-glide-control): its `offset`, and
 * any value of `glideMs`, `aim`, `jump` and `snap`, the way a game may hand them; the track may
 * grow.
 */
export type GlideTold = {
  at: number;
  glideMs?: unknown;
  aim?: unknown;
  jump?: boolean;
  snap?: readonly number[];
  track?: number;
};

/**
 * The glide strip as a render describes it: a 306 u window over the board's track, `max` 390.
 * Plain nodes, so a test can hand it a `glideMs` or an `aim` the types refuse.
 *
 * @param told - What the render tells the strip.
 * @returns The root node of the screen.
 */
export function glideNode(told: GlideTold): DescriptionNode {
  return {
    type: "column",
    key: "glideRoot",
    props: { style: rootStyle },
    children: [
      {
        type: "scroll",
        key: "glider",
        props: {
          axis: "x",
          offset: told.at,
          glideMs: told.glideMs,
          aim: told.aim,
          jump: told.jump,
          snap: told.snap,
          style: { width: PINNED, height: 120 }
        },
        children: [
          {
            type: "row",
            key: "glideTrack",
            props: { style: { width: told.track ?? TRACK, height: 120 } },
            children: []
          }
        ]
      }
    ]
  };
}

/** The first rows of the windowed glide list: 40 of 80 u in a 1600 u list scroll 1600 u. */
export const GLIDE_ROWS = 40;

/**
 * The windowed glide list: `rows` rows of 80 u in a 1600 u list, at `offset` `at`, every glide to
 * the prop 150 ms long.
 *
 * @param at - The offset prop.
 * @param rows - How many rows.
 * @returns The root node of the screen.
 */
export function glideRowsNode(at: number, rows: number): DescriptionNode {
  return (
    <column key="glideRowsRoot" style={rootStyle}>
      <scroll
        key="glideRows"
        style={{ width: 1080, height: WINDOW }}
        rows={rows}
        rowHeight={ROW}
        offset={at}
        glideMs={150}
        aim="orders"
        row={index => <row key={`g${index}`} style={{ width: 1080, height: ROW }} />}
      />
    </column>
  );
}

/**
 * Renders a screen of the fixture again with a new root node, the way its view would.
 *
 * @param app - The running app.
 * @param screen - The projection whose root renders.
 * @param node - The new root node.
 */
export function renderRoot(app: ScrollApp, screen: string, node: DescriptionNode): void {
  const root = app.world.projection.entityOf(screen, `${screen}Item`);

  if (root === undefined) throw new Error(`the screen "${screen}" is not mounted`);

  app.world.ecs.set(root, Tree, { node });
  app.time.step(16);
}

/**
 * The rows of a list: `count` rows of `ROW`.
 *
 * @param prefix - The start of every row key.
 * @param count - How many rows.
 * @returns The rows.
 */
function rowsOf(prefix: string, count: number): DescriptionNode[] {
  return Array.from({ length: count }, (_unused, index) => (
    <row key={`${prefix}${index}`} style={{ width: 400, height: ROW }} />
  ));
}

/** One row of a single-root screen. */
type ScreenItem = { id: string };

/**
 * Builds a projection of one item whose view is the given node.
 *
 * @param name - The projection name.
 * @param view - What the view returns.
 * @returns The projection.
 */
function screenOf(name: string, view: () => DescriptionNode) {
  return projection({
    name,
    layer: "ui",
    from: (): ScreenItem[] => [{ id: `${name}Item` }],
    key: (item: ScreenItem) => item.id,
    view
  });
}

/** The screens of the fixture. */
export const scrollScreens = [
  screenOf("strip", () => <StripScreen key="stripScreen" />),
  screenOf("turn", () => <TurnScreen key="turnScreen" />),
  screenOf("grow", () => <GrowScreen key="growScreen" />),
  screenOf("jump", () => <JumpScreen key="jumpScreen" />),
  screenOf("glide", () => glideNode({ at: 318 })),
  screenOf("aimed", () => glideNode({ at: 0, aim: "order-6" })),
  screenOf("glideRows", () => glideRowsNode(0, GLIDE_ROWS)),
  screenOf("free", () => (
    <column key="freeRoot" style={rootStyle}>
      <scroll key="free" axis="x" style={{ width: PINNED, height: 120 }}>
        <row key="freeTrack" style={{ width: FREE_TRACK, height: 120 }} />
      </scroll>
    </column>
  )),
  screenOf("list", () => (
    <column key="listRoot" style={rootStyle}>
      <scroll key="list" style={{ width: 400, height: 200 }}>
        <column key="listRows" style={{ width: 400 }}>
          {rowsOf("l", LIST_ROWS)}
        </column>
      </scroll>
    </column>
  )),
  screenOf("rows", () => (
    <column key="rowsRoot" style={rootStyle}>
      <scroll
        key="rows"
        style={{ width: 1080, height: WINDOW }}
        rows={WINDOW_ROWS}
        rowHeight={ROW}
        row={index => <row key={`r${index}`} style={{ width: 1080, height: ROW }} />}
      />
    </column>
  )),
  screenOf("nested", () => (
    <column key="nestedRoot" style={rootStyle}>
      <scroll key="page" style={{ width: 1080, height: 600 }}>
        <column key="pageBody" style={{ width: 1080 }}>
          <scroll key="shelf" axis="x" style={{ width: PINNED, height: 120 }}>
            <row key="shelfTrack" style={{ width: TRACK, height: 120 }} />
          </scroll>
          {rowsOf("p", 20)}
        </column>
      </scroll>
    </column>
  )),
  screenOf("sideRows", () => ({
    type: "scroll",
    key: "sideRows",
    props: {
      axis: "x",
      style: { width: 1080, height: WINDOW },
      rows: 10,
      rowHeight: ROW,
      row: (index: number): DescriptionNode => ({
        type: "row",
        key: `s${index}`,
        props: { style: { width: 1080, height: ROW } },
        children: []
      })
    },
    children: []
  }))
];

const { defineNode, defineFlow, defineFeature } = defineGame<{
  player: { visits: number };
  session: { visits: number };
  assets: string;
  strings: Record<string, never>;
}>();

const home = defineNode({ rest: true, outcomes: { stay: type() } });

const main = defineFlow("main", {
  nodes: { home },
  start: "home",
  outcomes: {},
  edges: { home: { stay: "home" } }
});

/** The feature of the scroll fixture. */
export const scrollFeature = defineFeature("scroll", {
  flows: [main],
  projections: scrollScreens,
  ui: [StripScreen, TurnScreen, GrowScreen, JumpScreen]
});

/** Yields the microtask queue to the loop, the way a test waits without a timer. */
async function tick(times = 60): Promise<void> {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
}

/**
 * Starts the screen set plus `ui` headless, without a screen mounted.
 *
 * @returns The started app.
 */
export async function startScrollApp() {
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
      scrollFeature
    ],
    pluginConfigs: {
      flow: { mainFlow: main },
      i18n: { locale: "en", fallback: "en" },
      model: { initialPlayer: { visits: 0 }, initialSession: { visits: 0 }, seed: 1 }
    }
  });

  await app.start();
  app.flow.run().catch(() => undefined);
  await tick();

  app.world.projection.setLayers([{ name: "ui", sort: "order" }]);

  return app;
}

/** The app `startScrollApp` builds. */
export type ScrollApp = Awaited<ReturnType<typeof startScrollApp>>;

/**
 * Mounts one screen of the fixture and gives it two frames.
 *
 * @param app - The running app.
 * @param screen - The projection to mount.
 */
export function mount(app: ScrollApp, screen: string): void {
  app.world.projection.mount([screen], { kind: "plugin", name: "test" });
  frames(app, 2);
}

/**
 * Steps frames of 16 ms.
 *
 * @param app - The running app.
 * @param count - How many.
 */
export function frames(app: ScrollApp, count: number): void {
  for (let frame = 0; frame < count; frame += 1) app.time.step(16);
}

/**
 * The entity of a keyed element, failing the test when it is not on screen.
 *
 * @param app - The running app.
 * @param key - The key of the element.
 * @returns The entity.
 */
export function find(app: ScrollApp, key: string): number {
  // eslint-disable-next-line unicorn/no-array-callback-reference -- `ui.find` takes a key, not a callback.
  const entity = app.ui.find(key);

  if (entity === undefined) throw new Error(`no element "${key}" on screen`);

  return entity;
}

/**
 * Where a scroll stands, as a game reads it.
 *
 * @param app - The running app.
 * @param key - The key of the scroll.
 * @returns Its `ScrollState`.
 */
export function stateOf(app: ScrollApp, key: string): ScrollStateValue | undefined {
  return app.world.ecs.get(find(app, key), ScrollState);
}

/**
 * The entity of the content a scroll moves: its one child.
 *
 * @param app - The running app.
 * @param scroll - The scroll entity.
 * @returns The content entity.
 */
export function contentOf(app: ScrollApp, scroll: number): number {
  const [content] = [...app.world.ecs.query(Parent)]
    .filter(([, parent]) => parent.entity === scroll)
    .map(([entity]) => entity);

  return content ?? 0;
}

/**
 * The pose of the content of a scroll.
 *
 * @param app - The running app.
 * @param key - The key of the scroll.
 * @returns Its `Transform`.
 */
export function poseOf(app: ScrollApp, key: string): { x: number; y: number } | undefined {
  return app.world.ecs.get(contentOf(app, find(app, key)), Transform);
}

/**
 * Puts the finger down on a scroll at a point and steps the frame.
 *
 * @param app - The running app.
 * @param key - The key of the scroll.
 * @param x - Where the finger is, in reference units.
 * @param y - Where the finger is, in reference units.
 */
export function press(app: ScrollApp, key: string, x: number, y: number): void {
  const pointer = app.world.ecs.resource(Pointer);

  pointer.x = x;
  pointer.y = y;
  app.world.ecs.tag(find(app, key), Pressed);
  app.time.step(16);
}

/**
 * Moves the finger to a point and steps the frame.
 *
 * @param app - The running app.
 * @param x - Where the finger is now, in reference units.
 * @param y - Where the finger is now, in reference units.
 */
export function moveTo(app: ScrollApp, x: number, y: number): void {
  const pointer = app.world.ecs.resource(Pointer);

  pointer.x = x;
  pointer.y = y;
  app.time.step(16);
}

/**
 * Lifts the finger off a scroll and steps the release frame.
 *
 * @param app - The running app.
 * @param key - The key of the scroll.
 */
export function release(app: ScrollApp, key: string): void {
  app.world.ecs.untag(find(app, key), Pressed);
  app.time.step(16);
}

/**
 * The payloads of every log entry of one event so far.
 *
 * @param app - The running app.
 * @param event - The event name.
 * @returns The payloads, in order.
 */
export function logged(app: ScrollApp, event: string): Array<Log.LogEntry["data"]> {
  return app.log
    .trace()
    .filter(entry => entry.event === event)
    .map(entry => entry.data);
}
