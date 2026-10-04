/**
 * @file ui plugin — the app of the windowed scroll tests (14-ui Delta 10 Part B): P18's list of
 * 1000 rows of five elements, 120 u each, in a 1600 u list on a 1080 x 1920 screen, a list of
 * text fields, a list of rows without a key, and one screen per error and warning of rule 10.
 * Real flow runner, plain Bun, inert renderer, real Yoga.
 */
import { createApp, defineGame, projection, type } from "../../../index";
import { animPlugin } from "../../anim";
import { assetsPlugin } from "../../assets";
import { i18nPlugin } from "../../i18n";
import { inputPlugin } from "../../input";
import { Pointer, Pressed } from "../../input/components";
import { rendererPlugin } from "../../renderer";
import { Transform } from "../../renderer/components";
import { scenesPlugin } from "../../scenes";
import { textPlugin } from "../../text";
import { worldPlugin } from "../../world";
import { uiPlugin } from "../index";
import { defineComponent } from "../jsx/component";
import type { DescriptionNode, ElementMotion, UiNode } from "../jsx/types";

/** The height of every row of the fixture's lists, in reference units. */
export const ROW = 120;

/** The height of the list the window is cut from, in reference units. */
export const LIST = 1600;

/** How many rows the big list holds. */
export const ROWS = 1000;

/** How many times the view of the screen above the big list ran. */
export const counts = { screen: 0 };

/** One enter or exit hook a row of the big list played, with the key of the row. */
export type RowMotion = { hook: "enter" | "exit"; key: string | undefined };

/** Every enter and exit hook the rows of the big list played, in order. */
export const rowMotions: RowMotion[] = [];

/** The motion of every row of the big list: both hooks are recorded, the exit slides out. */
const rowMotion: ElementMotion = {
  enter: (_view, item) => {
    rowMotions.push({ hook: "enter", key: (item as DescriptionNode).key });

    return undefined;
  },
  exit: (view, item) => {
    rowMotions.push({ hook: "exit", key: (item as DescriptionNode).key });

    return view.tween(Transform, { x: 400 }, { ms: 200 });
  }
};

const rootStyle = { width: 1080, height: 1920 } as const;
const listStyle = { width: 1080, height: LIST, fill: 0x10_10_10 } as const;
const rowStyle = { width: 1080, height: ROW, gap: 8 } as const;
const avatarStyle = { width: 100, height: 100 } as const;
const nameStyle = { width: 300, height: 40 } as const;
const stateStyle = { width: 200, height: 40 } as const;
const openStyle = { width: 120, height: 100 } as const;
const controlsStyle = { width: 1080, height: 120 } as const;
const controlStyle = { width: 200, height: 100 } as const;
const fieldStyle = { width: 600, height: 80 } as const;

/** One row of P18's list: an avatar, two fixed-size texts and a button that opens the row. */
export const ShopRow = defineComponent("ShopRow", {
  local: { open: false },
  view: (props: { id: string }, local) => (
    <row style={rowStyle} motion={rowMotion}>
      <stack style={avatarStyle} />
      <text style={nameStyle} content={props.id} />
      <text style={stateStyle} content={local.open ? "open" : "shut"} />
      <button key={`${props.id}-open`} local={{ open: true }} style={openStyle} />
    </row>
  )
});

/**
 * The ids of the big list: `r0` to `r999`, cut to `count`, without the one at `dropped`.
 *
 * @param count - How many rows the list has.
 * @param dropped - The index of the item left out, or -1.
 * @returns The ids, in order.
 */
function idsOf(count: number, dropped: number): string[] {
  const ids = Array.from({ length: count }, (_unused, index) => `r${index}`);

  return dropped === -1 ? ids : ids.filter((_id, index) => index !== dropped);
}

/** The screen of the big list: the windowed scroll, and two buttons below it that change the list. */
export const WindowScreen = defineComponent("WindowScreen", {
  local: { count: ROWS, dropped: -1 },
  view: (_props: object, local) => {
    counts.screen += 1;

    const ids = idsOf(local.count, local.dropped);

    return (
      <column key="windowRoot" style={rootStyle}>
        <scroll
          key="shop"
          style={listStyle}
          rows={ids.length}
          rowHeight={ROW}
          row={index => (
            <ShopRow key={ids[index] ?? String(index)} id={ids[index] ?? String(index)} />
          )}
        />
        <row key="controls" style={controlsStyle}>
          <button key="shrink" local={{ count: 10 }} style={controlStyle} />
          <button key="dropFour" local={{ dropped: 4 }} style={controlStyle} />
        </row>
      </column>
    );
  }
});

/** One row of the form list: a text field. */
export const FormRow = defineComponent("FormRow", {
  local: { name: "" },
  view: (props: { id: string }) => (
    <row style={rowStyle}>
      <input key={`${props.id}-name`} local="name" style={fieldStyle} />
    </row>
  )
});

/** One row of a single-root screen. */
type ScreenItem = { id: string };

/**
 * Builds a projection of one item whose view is the given node. The item id is not a key of the
 * screen: the root view and the elements share the projection's keys.
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

/** A plain row of the small lists. */
const plainRow = (): DescriptionNode => ({ type: "row", props: { style: rowStyle }, children: [] });

/**
 * A windowed scroll written as a description node, so a test can hand it props no `.tsx` compiles.
 *
 * @param key - The key of the scroll.
 * @param props - Its props besides the style.
 * @param children - Its children.
 * @returns The node.
 */
function scrollNode(
  key: string,
  props: Record<string, unknown>,
  children: DescriptionNode[] = []
): DescriptionNode {
  return { type: "scroll", key, props: { style: listStyle, ...props }, children };
}

/**
 * The row of the broken list: two nodes at index 1, none at index 2, a keyed row elsewhere.
 *
 * @param index - The index of the row.
 * @returns What the row callback answers.
 */
function brokenRow(index: number): DescriptionNode {
  if (index === 1) return [plainRow(), plainRow()] as unknown as DescriptionNode;
  if (index === 2) return [] as unknown as DescriptionNode;

  return { type: "row", key: `b${index}`, props: { style: rowStyle }, children: [] };
}

/** The screens of the fixture. */
export const windowScreens = [
  screenOf("window", () => <WindowScreen key="screen" />),
  screenOf("form", () => (
    <column key="formRoot" style={rootStyle}>
      <scroll
        key="formList"
        style={listStyle}
        rows={50}
        rowHeight={ROW}
        row={index => <FormRow key={`f${index}`} id={`f${index}`} />}
      />
    </column>
  )),
  screenOf("plain", () => (
    <column key="plainRoot" style={rootStyle}>
      <scroll key="plainList" style={listStyle} rows={50} rowHeight={ROW} row={plainRow} />
    </column>
  )),
  screenOf("halfList", () => (
    <column key="halfRoot" style={rootStyle}>
      <scroll
        key="halfList"
        style={{ width: 1080, height: "50%" }}
        rows={ROWS}
        rowHeight={ROW}
        row={plainRow}
      />
    </column>
  )),
  screenOf("zeroHeight", () => scrollNode("zeroHeight", { rows: 10, rowHeight: 0, row: plainRow })),
  screenOf("partial", () => scrollNode("partial", { rows: 10, rowHeight: ROW })),
  screenOf("rounded", () => scrollNode("rounded", { rows: 10.7, rowHeight: ROW, row: plainRow })),
  screenOf("tightOverscan", () =>
    scrollNode("tightOverscan", { rows: ROWS, rowHeight: ROW, overscan: -2, row: plainRow })
  ),
  screenOf("childrenIgnored", () =>
    scrollNode("childrenIgnored", { rows: 3, rowHeight: ROW, row: plainRow }, [
      { type: "row", key: "ignored", props: { style: rowStyle }, children: [] }
    ])
  ),
  screenOf("brokenRow", () => scrollNode("brokenRow", { rows: 5, rowHeight: ROW, row: brokenRow })),
  screenOf("tallRow", () =>
    scrollNode("tallRow", {
      rows: 5,
      rowHeight: ROW,
      row: (index: number): DescriptionNode => ({
        type: "row",
        key: `t${index}`,
        props: { style: { width: 1080, height: 200 } },
        children: []
      })
    })
  )
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

/** The feature of the windowed scroll fixture. */
export const windowFeature = defineFeature("window", {
  flows: [main],
  projections: windowScreens,
  ui: [ShopRow, WindowScreen, FormRow]
});

/** Yields the microtask queue to the loop, the way a test waits without a timer. */
async function tick(times = 60): Promise<void> {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
}

/**
 * Starts the screen set plus `ui` headless and mounts one screen of the fixture, with the two
 * frames of a reconcile, a solve and the scroll step that writes the range.
 *
 * @param screen - The projection to mount.
 * @returns The started app.
 */
export async function startWindowApp(screen = "window") {
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
      windowFeature
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
  app.world.projection.mount([screen], { kind: "plugin", name: "test" });
  app.time.step(16);
  app.time.step(16);

  return app;
}

/** The app `startWindowApp` builds. */
export type WindowApp = Awaited<ReturnType<typeof startWindowApp>>;

/**
 * The entity of a keyed element, failing the test when it is not on screen.
 *
 * @param app - The running app.
 * @param key - The key of the element.
 * @returns The entity.
 */
export function find(app: WindowApp, key: string): number {
  // eslint-disable-next-line unicorn/no-array-callback-reference -- `ui.find` takes a key, not a callback.
  const entity = app.ui.find(key);

  if (entity === undefined) throw new Error(`no element "${key}" on screen`);

  return entity;
}

/**
 * Finds a keyed node in the snapshot.
 *
 * @param node - Where the search starts.
 * @param key - The key of the element.
 * @returns The node, or `undefined`.
 */
export function nodeOf(node: UiNode, key: string): UiNode | undefined {
  if (node.key === key) return node;

  for (const child of node.children) {
    const found = nodeOf(child, key);

    if (found !== undefined) return found;
  }

  return undefined;
}

/**
 * Puts the finger down on a scroll container at a height of the page and steps the frame.
 *
 * @param app - The running app.
 * @param key - The key of the scroll.
 * @param y - Where the finger is, in reference units.
 */
export function press(app: WindowApp, key: string, y = 1000): void {
  app.world.ecs.resource(Pointer).y = y;
  app.world.ecs.tag(find(app, key), Pressed);
  app.time.step(16);
}

/**
 * Moves the finger to a height and steps the frame.
 *
 * @param app - The running app.
 * @param y - Where the finger is now, in reference units.
 */
export function moveTo(app: WindowApp, y: number): void {
  app.world.ecs.resource(Pointer).y = y;
  app.time.step(16);
}

/**
 * Lifts the finger off a scroll container and steps the frame.
 *
 * @param app - The running app.
 * @param key - The key of the scroll.
 */
export function release(app: WindowApp, key: string): void {
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
export function logged(app: WindowApp, event: string): unknown[] {
  return app.log
    .trace()
    .filter(entry => entry.event === event)
    .map(entry => entry.data);
}
