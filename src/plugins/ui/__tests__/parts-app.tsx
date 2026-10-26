/**
 * @file ui plugin — the app of the build-in-parts tests (spec 33, slice A): the screen set plus
 * `ui`, a ward on the screen and the scenes a test builds aside, on a clock that may advance with
 * every read, so `world.projection.left()` runs out after a known number of reads. The checks `ui`
 * registers with `onBuild` and `onConverged` are handed out, so a test asks `ui`'s part of a build
 * alone and plays a restore at the moment it picks. Plain Bun, inert renderer, real Yoga.
 */
import { vi } from "vitest";
import {
  component,
  createApp,
  defineGame,
  projection,
  Sprite,
  Transform,
  type
} from "../../../index";
import { animPlugin } from "../../anim";
import { assetsPlugin } from "../../assets";
import { fakeClock } from "../../clock/fake";
import type { ClockSource } from "../../clock/types";
import { i18nPlugin } from "../../i18n";
import { inputPlugin } from "../../input";
import { rendererPlugin } from "../../renderer";
import { Overlay } from "../../renderer/components";
import { scenesPlugin } from "../../scenes";
import { textPlugin } from "../../text";
import { worldPlugin } from "../../world";
import type { Entity, LayerSpec } from "../../world/types";
import { uiPlugin } from "../index";
import type { DescriptionNode, UiNode } from "../jsx/types";

/**
 * The player of the fixture: how many rows the big scene draws, whether its cells are wide (and
 * five, not four), whether it shows, and how many rows the section of the listed scene holds.
 */
export type PartsPlayer = { rows: number; wide: boolean; shown: boolean; extra: number };

const { defineNode, defineFlow, defineFeature } = defineGame<{
  player: PartsPlayer;
  session: Record<string, never>;
  assets: string;
  strings: Record<string, never>;
}>();

/** Names an element of a scene built aside for a test: `find` does not answer for one before the swap. */
export const Mark = component("PartsMark", { name: "" });

/** The rows the big scene starts with: 23 rows of 13 elements under its root, 300 elements. */
export const BIG_ROWS = 23;

/** The cells of one row of the big scene. */
const CELLS: readonly number[] = [0, 1, 2, 3];

/** The cells of one row once they are wide: one more. */
const WIDE_CELLS: readonly number[] = [0, 1, 2, 3, 4];

/** One item of a single-root screen. */
type Item = { id: string };

/** The item of the big scene. */
type BigItem = { id: string; rows: number; wide: boolean };

/**
 * A run of plain leaves, each a square.
 *
 * @param prefix - The key prefix.
 * @param count - How many.
 * @param side - The side of each, 10 u unless given.
 * @returns The leaves.
 */
function leaves(prefix: string, count: number, side = 10) {
  return Array.from({ length: count }, (_unused, index) => (
    <stack key={`${prefix}${index}`} style={{ width: side, height: side }} />
  ));
}

/** The scene on the screen while another one builds. */
const wardScreen = projection({
  name: "parts.ward",
  layer: "ui",
  from: (): Item => ({ id: "ward" }),
  view: () => (
    <column key="wardRoot" style={{ width: 1080, height: 1920 }}>
      <button key="wardPlay" intent="grow" style={{ width: 200, height: 80 }} />
    </column>
  )
});

/**
 * The big scene: 300 elements four deep, its rows and the width of its cells read from the player,
 * gone while `shown` is false.
 */
const bigScreen = projection({
  name: "parts.big",
  layer: "ui",
  from: (player: PartsPlayer): BigItem[] =>
    player.shown ? [{ id: "big", rows: player.rows, wide: player.wide }] : [],
  key: (item: BigItem) => item.id,
  view: (item: BigItem) => (
    <column key="bigRoot" style={{ width: 1080, height: 1920, gap: 2 }}>
      {Array.from({ length: item.rows }, (_unused, row) => (
        <row key={`r${row}`} style={{ width: 1000, height: 40, gap: 4 }}>
          {(item.wide ? WIDE_CELLS : CELLS).map(cell => (
            <row key={`c${row}_${cell}`} style={{ width: item.wide ? 70 : 60, height: 30 }}>
              <stack key={`d${row}_${cell}a`} style={{ width: 10, height: 10, fill: 0x22_33_44 }} />
              <stack key={`d${row}_${cell}b`} style={{ width: 10, height: 10, fill: 0x44_33_22 }} />
            </row>
          ))}
        </row>
      ))}
    </column>
  )
});

/** Two sections behind ten leaves: past a budget of 0 both are parked, the first one first. */
const orderedScreen = projection({
  name: "parts.ordered",
  layer: "ui",
  from: (): Item => ({ id: "ordered" }),
  view: () => (
    <column key="orderRoot" style={{ width: 1080, height: 1920 }}>
      {leaves("f", 10)}
      <column key="secA" style={{ width: 200 }}>
        {leaves("a", 6)}
      </column>
      <column key="secB" style={{ width: 200 }}>
        {leaves("b", 6)}
      </column>
    </column>
  )
});

/**
 * One row of the windowed list.
 *
 * @param index - The index of the row.
 * @returns The row.
 */
function windowRow(index: number): DescriptionNode {
  return <row key={`w${index}`} style={{ width: 400 }} />;
}

/**
 * Two scrolls before 175 leaves, so an application capped at 100 a frame makes both live in its
 * first part and ends two parts later: a scroll that stands at its `offset` prop, and a windowed
 * list that grows into the rest of the column, its range cut first at the viewport's height.
 */
const scrollsScreen = projection({
  name: "parts.scrolls",
  layer: "ui",
  from: (): Item => ({ id: "scrolls" }),
  view: () => (
    <column key="scrollRoot" style={{ width: 1080, height: 1920 }}>
      <scroll
        key="win"
        rows={60}
        rowHeight={40}
        overscan={0}
        row={windowRow}
        style={{ width: 400, grow: 1 }}
        components={[Mark({ name: "win" })]}
      />
      <scroll
        key="list"
        offset={120}
        style={{ width: 400, height: 200 }}
        components={[Mark({ name: "list" })]}
      >
        {Array.from({ length: 20 }, (_unused, index) => (
          <row key={`l${index}`} style={{ width: 400, height: 40 }} />
        ))}
      </scroll>
      {leaves("f", 175, 4)}
    </column>
  )
});

/** The world projection the host of `parts.hosted` names: three sprites. */
const piecesScreen = projection({
  name: "parts.pieces",
  layer: "pieces",
  from: (): Array<{ id: string; x: number }> => [0, 1, 2].map(x => ({ id: `p${x}`, x })),
  key: (item: { id: string }) => item.id,
  view: (item: { id: string; x: number }) => [
    Sprite({ texture: "ui.coin" }),
    Transform({ x: item.x, y: 0 })
  ]
});

/** A host behind 50 leaves and before 100: an application capped at 100 a frame makes it live in its first part. */
const hostedScreen = projection({
  name: "parts.hosted",
  layer: "ui",
  from: (): Item => ({ id: "hosted" }),
  view: () => (
    <column key="hostRoot" style={{ width: 1080, height: 1920 }}>
      {leaves("f", 50)}
      <stack
        key="host"
        hosts={["parts.pieces"]}
        style={{ width: 300, height: 100 }}
        components={[Mark({ name: "host" })]}
      />
      {leaves("g", 100)}
    </column>
  )
});

/** An overlay behind 100 leaves: its dim lands after the swap, as in a one-block build. */
const overlayScreen = projection({
  name: "parts.overlay",
  layer: "ui",
  from: (): Item => ({ id: "overlay" }),
  view: () => (
    <column key="dimRoot" style={{ width: 1080, height: 1920 }}>
      {leaves("f", 100)}
      <stack
        key="dim"
        style={{ width: 1080, height: 400 }}
        components={[Overlay({ dim: 0.5, fade: 0 }), Mark({ name: "dim" })]}
      />
    </column>
  )
});

/** The item of the listed scene. */
type ListedItem = { id: string; extra: number };

/**
 * One row of the windowed list of the listed scene.
 *
 * @param index - The index of the row.
 * @returns The row.
 */
function tallRow(index: number): DescriptionNode {
  return <row key={`t${index}`} style={{ width: 400 }} />;
}

/**
 * A windowed list first in a column, rows of 600 u, growing into what the section and 20 leaves
 * leave it, so its range is cut first at the viewport's height; then a section of the player's
 * `extra` rows of two leaves each. Built on a budget of 0, its first application stops after 8
 * elements with the list live; a commit then adds the section's rows, and past the 8th of them
 * their leaves are parked.
 */
const listedScreen = projection({
  name: "parts.listed",
  layer: "ui",
  from: (player: PartsPlayer): ListedItem => ({ id: "listed", extra: player.extra }),
  view: (item: ListedItem) => (
    <column key="listedRoot" style={{ width: 1080, height: 1920 }}>
      <scroll
        key="tall"
        rows={20}
        rowHeight={600}
        overscan={0}
        row={tallRow}
        style={{ width: 400, grow: 1 }}
        components={[Mark({ name: "tall" })]}
      />
      <column key="section" style={{ width: 400 }}>
        {Array.from({ length: item.extra }, (_unused, index) => (
          <row key={`s${index}`} style={{ width: 400, height: 20 }}>
            {leaves(`s${index}d`, 2)}
          </row>
        ))}
      </column>
      {leaves("f", 20)}
    </column>
  )
});

/** A text field that names no local field: its enter throws, as a broken tag does. */
const BROKEN_FIELD: DescriptionNode = {
  type: "input",
  key: "brokenField",
  props: { style: { width: 100, height: 40 } },
  children: []
};

/** Two sections behind ten leaves, the first holding the broken field: past a budget of 0 its part throws. */
const brokenScreen = projection({
  name: "parts.broken",
  layer: "ui",
  from: (): Item => ({ id: "broken" }),
  view: () => (
    <column key="brokenRoot" style={{ width: 1080, height: 1920 }}>
      {leaves("f", 10)}
      <column key="brokenSec" style={{ width: 200 }}>
        {leaves("k", 2)}
        {BROKEN_FIELD}
      </column>
      <column key="fineSec" style={{ width: 200 }}>
        {leaves("n", 2)}
      </column>
    </column>
  )
});

const home = defineNode({
  rest: true,
  outcomes: { grow: type(), shrink: type(), hide: type(), more: type() }
});

/** Three more rows and wider cells. */
const grow = defineNode({
  outcomes: { done: type() },
  run: ({ player, out }) => {
    player.rows += 3;
    player.wide = true;

    return out.done();
  }
});

/** Three rows fewer. */
const shrink = defineNode({
  outcomes: { done: type() },
  run: ({ player, out }) => {
    player.rows -= 3;

    return out.done();
  }
});

/** Six rows in the section of the listed scene. */
const more = defineNode({
  outcomes: { done: type() },
  run: ({ player, out }) => {
    player.extra += 6;

    return out.done();
  }
});

/** The big scene leaves. */
const hide = defineNode({
  outcomes: { done: type() },
  run: ({ player, out }) => {
    player.shown = false;

    return out.done();
  }
});

const main = defineFlow("main", {
  nodes: { home, grow, shrink, hide, more },
  start: "home",
  outcomes: {},
  edges: {
    home: { grow: "grow", shrink: "shrink", hide: "hide", more: "more" },
    more: { done: "home" },
    grow: { done: "home" },
    shrink: { done: "home" },
    hide: { done: "home" }
  }
});

const partsFeature = defineFeature("parts", {
  flows: [main],
  projections: [
    wardScreen,
    bigScreen,
    orderedScreen,
    scrollsScreen,
    piecesScreen,
    hostedScreen,
    overlayScreen,
    brokenScreen,
    listedScreen
  ],
  components: [Mark]
});

/** The layer list the ward and every scene built aside declare alike: the ward is kept. */
export const LAYERS: ReadonlyArray<LayerSpec> = [
  { name: "pieces", sort: "order" },
  { name: "ui", sort: "order" }
];

/** Who owns the entities of the projections the tests mount. */
const OWNER = { kind: "plugin", name: "test" } as const;

/**
 * A clock source whose moment moves `stepMs` on with every read, over a fake clock the frames
 * advance: past a budget of `n × stepMs` ms, `world.projection.left()` reads 0 or less.
 *
 * @param stepMs - Milliseconds every read moves the clock on; 0 holds it between frames.
 * @returns The source for the clock plugin and the fake clock under it.
 */
function steppingClock(stepMs: number) {
  const base = fakeClock(1000);
  const source: ClockSource = {
    now: () => {
      const moment = base.now();

      base.set(moment + stepMs);

      return moment;
    },
    setTimer: (callback, delayMs) => base.setTimer(callback, delayMs),
    clearTimer: handle => base.clearTimer(handle)
  };

  return { source, base };
}

/**
 * Yields the microtask queue, the way a test lets the flow run without a timer.
 */
export async function settle(): Promise<void> {
  for (let index = 0; index < 60; index += 1) await Promise.resolve();
}

/**
 * Starts the app on a clock that moves `stepMs` with every read, with the ward mounted and at
 * rest, and catches `ui`'s part of a build and its converge listener while they register.
 *
 * @param stepMs - Milliseconds every clock read moves the clock on.
 * @returns The app and its drivers.
 */
export async function startParts(stepMs = 0) {
  const clock = steppingClock(stepMs);
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
      partsFeature
    ],
    pluginConfigs: {
      clock: { source: clock.source },
      flow: { mainFlow: main, holdMs: 0 },
      i18n: { locale: "en", fallback: "en" },
      model: {
        initialPlayer: { rows: BIG_ROWS, wide: false, shown: true, extra: 0 },
        initialSession: {},
        seed: 1
      }
    }
  });
  const checks: Array<() => boolean> = [];
  const listeners: Array<() => void> = [];
  const { onBuild, onConverged } = app.world.projection;

  vi.spyOn(app.world.projection, "onBuild").mockImplementation(check => {
    checks.push(check);

    return onBuild(check);
  });
  vi.spyOn(app.world.projection, "onConverged").mockImplementation(listener => {
    listeners.push(listener);

    return onConverged(listener);
  });
  await app.start();
  vi.restoreAllMocks();
  app.flow.run().catch(() => undefined);
  await settle();

  // The renderer registers a part of its own: ui's is the reconciler's `asideBuilt`.
  const built = checks.find(check => check.name === "asideBuilt");
  const converged = listeners.find(listener => listener.name === "converged");

  if (built === undefined || converged === undefined) {
    throw new Error("ui registered no part of a scene build or no converge listener");
  }

  /** Steps one frame of 16 ms, the fake clock first. */
  const frame = (): void => {
    clock.base.advance(16);
    app.time.step(16);
  };

  app.world.projection.setLayers(LAYERS);
  app.world.projection.mount(["parts.ward"], OWNER);

  for (let index = 0; index < 3; index += 1) frame();

  return {
    app,
    /** `ui`'s part of the running build. */
    built,
    /** What `world` calls after a restore or a load. */
    converged,
    frame,
    /**
     * Builds the ward and these projections aside, as a live switch does.
     *
     * @param names - The projections of the coming scene besides the ward.
     * @param budgetMs - The building budget of a frame.
     * @returns True when the build runs.
     */
    build: (names: readonly string[], budgetMs: number): boolean =>
      app.world.projection.build(["parts.ward", ...names], OWNER, LAYERS, budgetMs),
    /** The swap, as `scenes` makes it: the layer list, then the commit. */
    commit: (): void => {
      app.world.projection.setLayers(LAYERS);
      app.world.projection.commit();
    },
    /**
     * Mounts the ward and these projections in one block, as a one-block switch does.
     *
     * @param names - The projections besides the ward.
     */
    mount: (names: readonly string[]): void => {
      app.world.projection.mount(["parts.ward", ...names], OWNER);
    }
  };
}

/** A started fixture. */
export type Parts = Awaited<ReturnType<typeof startParts>>;

/**
 * Steps frames until `ui`'s part of the build is done.
 *
 * @param parts - The started fixture, a build running.
 * @param most - The most frames to step.
 * @returns How many frames it took.
 */
export function untilBuilt(parts: Parts, most = 200): number {
  for (let frames = 1; frames <= most; frames += 1) {
    parts.frame();

    if (parts.built()) return frames;
  }

  throw new Error(`ui's part of the build was not done in ${most} frames`);
}

/**
 * The entity of an element a test marked with `Mark`.
 *
 * @param parts - The started fixture.
 * @param name - The mark's name.
 * @returns The entity, or `undefined` before the element is live.
 */
export function marked(parts: Parts, name: string): Entity | undefined {
  for (const [entity, mark] of parts.app.world.ecs.query(Mark)) {
    if (mark.name === name) return entity;
  }

  return undefined;
}

/**
 * A number rounded to 0.01.
 *
 * @param value - The number.
 * @returns It, rounded.
 * @example
 * ```ts
 * round(12.3456); // 12.35
 * ```
 */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * A snapshot node with every rect rounded to 0.01, so two builds compare by what a player sees.
 *
 * @param node - The node.
 * @returns The node, rounded all the way down.
 */
export function rounded(node: UiNode): UiNode {
  const { x, y, w, h } = node.rect;

  return {
    ...node,
    rect: { x: round(x), y: round(y), w: round(w), h: round(h) },
    children: node.children.map(child => rounded(child))
  };
}
