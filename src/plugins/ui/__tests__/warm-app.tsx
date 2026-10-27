/**
 * @file ui plugin — the app of the warm window tests (spec 33, slice B+D): the screen set plus `ui`,
 * a ward on the screen and the sheets a game keeps warm, on a clock that may advance with every
 * read, so the warm budget of a frame runs out after a known number of reads. The renderer is
 * inert: `ui` is told it draws (`host.kind()`), so it registers its part of a build and the world
 * warms; a test that leaves `drawing` off gets a headless app. Real flow, world and Yoga.
 */
import { vi } from "vitest";
import { component, createApp, defineGame, projection, type } from "../../../index";
import { animPlugin } from "../../anim";
import { assetsPlugin } from "../../assets";
import { i18nPlugin } from "../../i18n";
import { inputPlugin } from "../../input";
import { rendererPlugin } from "../../renderer";
import { Overlay } from "../../renderer/components";
import { scenesPlugin } from "../../scenes";
import { textPlugin } from "../../text";
import { worldPlugin } from "../../world";
import { Tree } from "../../world/ecs/define";
import type { Entity, LayerSpec } from "../../world/types";
import { uiPlugin } from "../index";
import type { ElementMotion } from "../jsx/types";
import { settle, steppingClock } from "./parts-app";

/** The player of the fixture: the coins the sheet shows and the offset its shelf stands at. */
export type WarmPlayer = { coins: number; offset: number };

/** The session of the fixture: the sheet open, by name, or `""`. */
type WarmSession = { open: string };

const { defineNode, defineFlow, defineFeature } = defineGame<{
  player: WarmPlayer;
  session: WarmSession;
  assets: string;
  strings: Record<string, never>;
}>();

/** Names an element of a sheet for a test: `find` does not answer for one while it is held. */
export const Marked = component("WarmMarked", { name: "" });

/**
 * What the hooks of the sheets' elements saw: the keys whose enter played, the `change.Box` plays,
 * and the loops the rows of the windowed list started.
 */
export const seen = { enters: [] as string[], changes: 0, loops: 0 };

/**
 * The motion of a keyed element of the big sheet: its enter notes its key, a moved rect is counted.
 *
 * @param key - The key the enter notes.
 * @returns The motion.
 */
function noted(key: string): ElementMotion {
  return {
    enter: () => {
      seen.enters.push(key);

      return undefined;
    },
    change: {
      Box: () => {
        seen.changes += 1;

        return undefined;
      }
    }
  };
}

/** The motion of the root of the big sheet. */
const ROOT_MOTION = noted("sheetRoot");

/** The motion of the sheet's button. */
const BUY_MOTION = noted("buy");

/** The motion of every cell of the big sheet: no enter of its own is noted, a moved rect is. */
const CELL_MOTION: ElementMotion = {
  change: {
    Box: () => {
      seen.changes += 1;

      return undefined;
    }
  }
};

/** The motion of a row of the windowed list: its loop is counted, and so is a moved rect. */
const ROW_MOTION: ElementMotion = {
  loop: () => {
    seen.loops += 1;

    return undefined;
  },
  change: {
    Box: () => {
      seen.changes += 1;

      return undefined;
    }
  }
};

/** The rows of the big sheet: with its root and its button, 262 elements. */
const ROWS = 20;

/** The cells of one row of the big sheet. */
const CELLS: readonly number[] = [0, 1, 2, 3];

/** The item of the big sheet. */
type SheetItem = { id: string; coins: number };

/** The item of the sheet with a shelf. */
type ListItem = { id: string; offset: number };

/** One item of a single-root screen. */
type Item = { id: string };

/** The screen on the screen while the sheets rest held. */
const wardScreen = projection({
  name: "warm.ward",
  layer: "ui",
  from: (): Item => ({ id: "ward" }),
  view: () => (
    <column key="wardRoot" style={{ width: 1080, height: 1920 }}>
      <button key="wardPlay" intent="openSheet" style={{ width: 200, height: 80 }} />
    </column>
  )
});

/**
 * The item of the big sheet: the open one and the warm one are equal, so the open writes nothing.
 *
 * @param player - The player root.
 * @returns The item.
 */
function sheetItem(player: WarmPlayer): SheetItem {
  return { id: "sheet", coins: player.coins };
}

/**
 * The big sheet: 262 elements, its rows centered in the height of the viewport, so a taller one
 * moves every row.
 */
const sheetScreen = projection({
  name: "warm.sheet",
  layer: "ui",
  from: (player: WarmPlayer, session: WarmSession): SheetItem[] =>
    session.open === "sheet" ? [sheetItem(player)] : [],
  key: (item: SheetItem) => item.id,
  view: (item: SheetItem) => (
    <column
      key="sheetRoot"
      style={{ width: 1080, height: "100%", gap: 2, justify: "center" }}
      motion={ROOT_MOTION}
    >
      <button
        key="buy"
        intent="close"
        style={{ width: 200 + item.coins, height: 80 }}
        motion={BUY_MOTION}
      />
      {Array.from({ length: ROWS }, (_unused, row) => (
        <row key={`r${row}`} style={{ width: 1000, height: 40, gap: 4 }} motion={CELL_MOTION}>
          {CELLS.map(cell => (
            <row key={`c${row}_${cell}`} style={{ width: 60, height: 30 }} motion={CELL_MOTION}>
              <stack key={`d${row}_${cell}a`} style={{ width: 10, height: 10, fill: 0x22_33_44 }} />
              <stack key={`d${row}_${cell}b`} style={{ width: 10, height: 10, fill: 0x44_33_22 }} />
            </row>
          ))}
        </row>
      ))}
    </column>
  ),
  warm: (player: WarmPlayer) => sheetItem(player)
});

/**
 * The item of the sheet with a shelf: the offset its shelf stands at.
 *
 * @param player - The player root.
 * @returns The item.
 */
function listItem(player: WarmPlayer): ListItem {
  return { id: "list", offset: player.offset };
}

/** A sheet with a shelf of twenty rows that stands at the player's offset. */
const listScreen = projection({
  name: "warm.list",
  layer: "ui",
  from: (player: WarmPlayer, session: WarmSession): ListItem[] =>
    session.open === "list" ? [listItem(player)] : [],
  key: (item: ListItem) => item.id,
  view: (item: ListItem) => (
    <column key="listRoot" style={{ width: 1080, height: 1920 }}>
      <scroll
        key="shelf"
        offset={item.offset}
        style={{ width: 400, height: 200 }}
        components={[Marked({ name: "shelf" })]}
      >
        {Array.from({ length: 20 }, (_unused, index) => (
          <row key={`l${index}`} style={{ width: 400, height: 40 }} />
        ))}
      </scroll>
    </column>
  ),
  warm: (player: WarmPlayer) => listItem(player)
});

/** The item of the sheet with a windowed list: the coins widen its rows. */
type RowsItem = { id: string; coins: number };

/**
 * The item of the sheet with a windowed list.
 *
 * @param player - The player root.
 * @returns The item.
 */
function rowsItem(player: WarmPlayer): RowsItem {
  return { id: "rows", coins: player.coins };
}

/**
 * A sheet with a windowed list of 60 rows of 40 u, 400 u high, that stands at 400 u: its first
 * range is cut at 0 when it is made, and the rows from the 10th on come once it stands at its
 * offset, after the sheet was built.
 */
const rowsScreen = projection({
  name: "warm.rows",
  layer: "ui",
  from: (player: WarmPlayer, session: WarmSession): RowsItem[] =>
    session.open === "rows" ? [rowsItem(player)] : [],
  key: (item: RowsItem) => item.id,
  view: (item: RowsItem) => (
    <column key="rowsRoot" style={{ width: 1080, height: 1920 }}>
      <scroll
        key="win"
        rows={60}
        rowHeight={40}
        overscan={0}
        offset={400}
        row={(index: number) => (
          <row
            key={`w${index}`}
            style={{ width: 300 + item.coins }}
            motion={ROW_MOTION}
            components={[Marked({ name: `w${index}` })]}
          />
        )}
        style={{ width: 400, height: 400 }}
      />
    </column>
  ),
  warm: (player: WarmPlayer) => rowsItem(player)
});

/**
 * A sheet whose button bears the key of its own view, `"clash"`: `world` refuses it once the view is
 * live, as a mount of it would.
 */
const clashScreen = projection({
  name: "warm.clash",
  layer: "ui",
  from: (_player: WarmPlayer, session: WarmSession): Item[] =>
    session.open === "clash" ? [{ id: "clash" }] : [],
  key: (item: Item) => item.id,
  view: () => (
    <column key="clashRoot" style={{ width: 1080, height: 1920 }}>
      <button key="clash" intent="close" style={{ width: 200, height: 80 }} />
      <button key="clashAfter" intent="close" style={{ width: 200, height: 80 }} />
    </column>
  ),
  warm: (): Item => ({ id: "clash" })
});

/** A sheet that dims what lies under it while it is open. */
const dimScreen = projection({
  name: "warm.dim",
  layer: "ui",
  from: (_player: WarmPlayer, session: WarmSession): Item[] =>
    session.open === "dim" ? [{ id: "dim" }] : [],
  key: (item: Item) => item.id,
  view: () => (
    <column key="dimRoot" style={{ width: 1080, height: 1920 }}>
      <stack
        key="dim"
        style={{ width: 1080, height: 400 }}
        components={[Overlay({ dim: 0.5, fade: 0 }), Marked({ name: "dim" })]}
      />
    </column>
  ),
  warm: (): Item => ({ id: "dim" })
});

const home = defineNode({
  rest: true,
  outcomes: {
    openSheet: type(),
    openList: type(),
    openDim: type(),
    openRows: type(),
    openClash: type(),
    close: type(),
    scroll: type(),
    coin: type()
  }
});

/**
 * A node that opens one sheet.
 *
 * @param name - The sheet.
 * @returns The node.
 */
function opens(name: string) {
  return defineNode({
    outcomes: { done: type() },
    run: ({ session, out }) => {
      session.open = name;

      return out.done();
    }
  });
}

/** Every sheet closes. */
const close = defineNode({
  outcomes: { done: type() },
  run: ({ session, out }) => {
    session.open = "";

    return out.done();
  }
});

/** One more coin: the rows of the windowed list widen. */
const coin = defineNode({
  outcomes: { done: type() },
  run: ({ player, out }) => {
    player.coins += 1;

    return out.done();
  }
});

/** The shelf of the list sheet stands 120 u further down. */
const scroll = defineNode({
  outcomes: { done: type() },
  run: ({ player, out }) => {
    player.offset += 120;

    return out.done();
  }
});

const main = defineFlow("main", {
  nodes: {
    home,
    openSheet: opens("sheet"),
    openList: opens("list"),
    openDim: opens("dim"),
    openRows: opens("rows"),
    openClash: opens("clash"),
    close,
    scroll,
    coin
  },
  start: "home",
  outcomes: {},
  edges: {
    home: {
      openSheet: "openSheet",
      openList: "openList",
      openDim: "openDim",
      openRows: "openRows",
      openClash: "openClash",
      close: "close",
      scroll: "scroll",
      coin: "coin"
    },
    openSheet: { done: "home" },
    openList: { done: "home" },
    openDim: { done: "home" },
    openRows: { done: "home" },
    openClash: { done: "home" },
    close: { done: "home" },
    scroll: { done: "home" },
    coin: { done: "home" }
  }
});

const warmFeature = defineFeature("warm", {
  flows: [main],
  projections: [wardScreen, sheetScreen, listScreen, rowsScreen, dimScreen, clashScreen],
  components: [Marked]
});

/** The layer list of the scene. */
const LAYERS: ReadonlyArray<LayerSpec> = [{ name: "ui", sort: "order" }];

/** Who owns the entities of the projections the tests mount. */
const OWNER = { kind: "plugin", name: "test" } as const;

/** What a test changes about the app it starts. */
export type WarmOptions = {
  /** Milliseconds every clock read moves the clock on; 0 holds it between frames. */
  stepMs?: number;
  /** False for a headless app: the renderer says it draws nothing. */
  drawing?: boolean;
};

/**
 * Starts the app at rest, nothing mounted yet, and catches every check registered with `onBuild`
 * while the plugins start. A test mounts the ward with its sheets in one list, so each takes its
 * place in it, above the ward.
 *
 * @param options - The clock step and whether the renderer draws.
 * @returns The app and its drivers.
 */
export async function startWarm(options: WarmOptions = {}) {
  const clock = steppingClock(options.stepMs ?? 0);
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
      warmFeature
    ],
    pluginConfigs: {
      clock: { source: clock.source },
      flow: { mainFlow: main, holdMs: 0 },
      i18n: { locale: "en", fallback: "en" },
      model: { initialPlayer: { coins: 5, offset: 40 }, initialSession: { open: "" }, seed: 1 }
    }
  });
  const checks: Array<() => boolean> = [];
  const { onBuild } = app.world.projection;

  vi.spyOn(app.world.projection, "onBuild").mockImplementation(check => {
    checks.push(check);

    return onBuild(check);
  });
  if (options.drawing !== false) vi.spyOn(app.renderer.host, "kind").mockReturnValue("webgpu");
  await app.start();
  vi.restoreAllMocks();
  app.flow.run().catch(() => undefined);
  await settle();

  seen.enters.length = 0;
  seen.changes = 0;
  seen.loops = 0;

  /** Steps one frame of 16 ms, the fake clock first. */
  const frame = (): void => {
    clock.base.advance(16);
    app.time.step(16);
  };

  app.world.projection.setLayers(LAYERS);

  for (let index = 0; index < 3; index += 1) frame();

  return {
    app,
    /** The checks registered with `onBuild`: `ui`'s is the reconciler's `asideBuilt`. */
    checks,
    frame,
    /**
     * Mounts the ward and these sheets, closed, as a scene that lists them does: once per app.
     *
     * @param names - The sheets besides the ward.
     */
    mount: (names: readonly string[]): void => {
      app.world.projection.mount(["warm.ward", ...names], OWNER);
    },
    /**
     * Answers the gate with an intent and lets the flow commit, with no frame.
     *
     * @param intent - An outcome of the resting node.
     */
    answer: async (intent: string): Promise<void> => {
      if (!app.flow.gate.answer({ intent })) throw new Error(`the gate refused "${intent}"`);

      await settle();
    }
  };
}

/** A started fixture. */
export type Warm = Awaited<ReturnType<typeof startWarm>>;

/**
 * The roots the world holds warm: every entity with a `Tree` that `isBuilding` answers for.
 *
 * @param warm - The started fixture.
 * @returns Their entities.
 */
export function heldTrees(warm: Warm): Entity[] {
  const held: Entity[] = [];

  for (const [entity] of warm.app.world.ecs.query(Tree)) {
    if (warm.app.world.projection.isBuilding(entity)) held.push(entity);
  }

  return held;
}

/**
 * Steps frames until the world holds this many sheets and none is in work any more.
 *
 * @param warm - The started fixture, its sheets mounted.
 * @param count - How many sheets are held.
 * @param most - The most frames to step.
 * @returns How many frames it took.
 */
export function untilWarm(warm: Warm, count: number, most = 200): number {
  for (let frames = 1; frames <= most; frames += 1) {
    warm.frame();

    const rests = warm.app.world.projection.left() === Number.POSITIVE_INFINITY;

    if (rests && heldTrees(warm).length === count) return frames;
  }

  throw new Error(`the world held no ${count} warm sheets in ${most} frames`);
}

/**
 * The entity of an element a sheet marked with `Marked`.
 *
 * @param warm - The started fixture.
 * @param name - The mark's name.
 * @returns The entity, or `undefined` before the element is live.
 */
export function markedIn(warm: Warm, name: string): Entity | undefined {
  for (const [entity, mark] of warm.app.world.ecs.query(Marked)) {
    if (mark.name === name) return entity;
  }

  return undefined;
}
