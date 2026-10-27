/**
 * @file Root integration — warm windows (spec 33, slice B+D): flow, scenes, world, ui, renderer, anim and time
 * together. The real screen set on the fake page, over Pixi's own display objects (`drawn-helpers.ts`), on a fake
 * clock. The ward keeps three windows warm: the settings sheet and its dim, opened by one answer, and a shop of about
 * 600 elements. While the ward rests they are built aside in idle frames and held off the stage; the answer that opens
 * one shows the held view in the next frame, with its enter; a close plays the exit and the window is warmed again; a
 * scene switch and a restore drop what is held. The tree oracle checks every frame.
 */
import type { Assets, World } from "@moku-labs/game";
import { defineGame, defineMotion, Overlay, Shape, Transform, Tree, type } from "@moku-labs/game";
import { defineGameApp } from "@moku-labs/game/app";
import { fakeClock } from "@moku-labs/game/testing";
import type * as pixi from "pixi.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FRAME_MS, openPage, type Watched, watch } from "./drawn-helpers";

/** The player: the coins the settings sheet shows. */
type Player = { coins: number };

/** The session: the window open, by name, or `""`. */
type Session = { sheet: string };

const { defineNode, defineFlow, defineFeature, defineScene, projection } = defineGame<{
  player: Player;
  session: Session;
  assets: string;
  scenes: "ward" | "board";
  strings: Record<string, never>;
}>();

/** Both scene bundles hold no file. */
const MANIFEST: Assets.Manifest = {
  version: 2,
  bundles: {
    ward: { feature: "warm", tier: "lazy", mb: 0, files: [] },
    board: { feature: "warm", tier: "lazy", mb: 0, files: [] }
  }
};

/** The rows of the shop: with its root and its close button, 599 elements. */
const SHOP_ROWS = 199;

/** The elements of the shop: the root, the close button and three per row. */
const SHOP_ELEMENTS = 2 + SHOP_ROWS * 3;

/** The windows the ward keeps warm. */
const WARD_WINDOWS = ["warm.settingsDim", "warm.settings", "warm.shop"] as const;

/**
 * What a frame of warm work may read of the clock past its budget: the one part `ui` and the one view the renderer
 * still start when the budget is all but spent, at least one each a frame.
 */
const OVERRUN_MS = 3;

/** The middle of the top-left button of every screen: the ward's settings button, the close button of a sheet. */
const TOP_BUTTON = { x: 100, y: 40 } as const;

/** A sheet fades in and out over 250 ms. */
const sheetFade = defineMotion({
  states: { faded: { Shape: { alpha: 0 } } },
  transition: { ms: 250 },
  on: { enter: "faded", exit: "faded" }
});

/** The ward's room: one rectangle in its own layer. */
const wardRoom = projection({
  name: "warm.wardRoom",
  layer: "room",
  from: () => ({ id: "room" }),
  view: () => [Transform({ x: 0, y: 0 }), Shape({ kind: "rect", w: 390, h: 844, fill: 0x9f_b7_b4 })]
});

/** The ward's HUD: the buttons that open the settings, the shop and the board. */
const wardHud = projection({
  name: "warm.wardHud",
  layer: "ui",
  from: () => ({ id: "hud" }),
  view: () => (
    <column key="wardHud" style={{ width: 390, height: 844 }}>
      <button key="wardSettings" intent="settings" style={{ width: 200, height: 80 }} />
      <button key="wardShop" intent="shop" style={{ width: 200, height: 80 }} />
      <button key="wardBoard" intent="board" style={{ width: 200, height: 80 }} />
    </column>
  )
});

/** One window of a scene, as `from` and `warm` give it. */
type Window = { id: string };

/** The settings sheet as its view gets it: the coins it shows widen its bar. */
type SettingsItem = { id: string; coins: number };

/**
 * The settings sheet's item: the open one and the warm one are equal, so the open writes nothing.
 *
 * @param player - The player root.
 * @returns The item.
 */
function settingsItem(player: Player): SettingsItem {
  return { id: "settings", coins: player.coins };
}

/** The dim under the settings sheet, a window of its own that the same answer opens. */
const settingsDim = projection({
  name: "warm.settingsDim",
  layer: "ui",
  from: (_player: Player, session: Session): Window[] =>
    session.sheet === "settings" ? [{ id: "dim" }] : [],
  key: (item: Window) => item.id,
  view: () => (
    <stack
      key="settingsDim"
      style={{ width: 390, height: 844 }}
      components={[Overlay({ dim: 0.5, fade: 0 })]}
    />
  ),
  warm: (): Window => ({ id: "dim" })
});

/** The settings sheet: it fades in, its close button over the ward's settings button. */
const settingsSheet = projection({
  name: "warm.settings",
  layer: "ui",
  from: (player: Player, session: Session): SettingsItem[] =>
    session.sheet === "settings" ? [settingsItem(player)] : [],
  key: (item: SettingsItem) => item.id,
  view: (item: SettingsItem) => (
    <column
      key="settingsRoot"
      motion={sheetFade}
      style={{ width: 390, height: 844, fill: 0xee_e4_cc }}
    >
      <button
        key="settingsClose"
        intent="close"
        style={{ width: 200, height: 80, fill: 0x7a_7a_7a }}
      />
      <stack key="settingsBar" style={{ width: 100 + item.coins, height: 20, fill: 0x30_60_90 }} />
    </column>
  ),
  warm: (player: Player) => settingsItem(player)
});

/** The shop: a close button and 199 rows of a row and two cells, 599 elements. */
const shopSheet = projection({
  name: "warm.shop",
  layer: "ui",
  from: (_player: Player, session: Session): Window[] =>
    session.sheet === "shop" ? [{ id: "shop" }] : [],
  key: (item: Window) => item.id,
  view: () => (
    <column key="shopRoot" style={{ width: 390, height: 844, fill: 0xf4_ea_d8 }}>
      <button key="shopClose" intent="close" style={{ width: 200, height: 80, fill: 0x7a_7a_7a }} />
      {Array.from({ length: SHOP_ROWS }, (_unused, index) => (
        <row key={`shopRow${index}`} style={{ width: 390, height: 3, gap: 2 }}>
          <stack key={`shopRow${index}a`} style={{ width: 8, height: 3, fill: 0x22_33_44 }} />
          <stack key={`shopRow${index}b`} style={{ width: 8, height: 3, fill: 0x44_33_22 }} />
        </row>
      ))}
    </column>
  ),
  warm: (): Window => ({ id: "shop" })
});

/** The board's cells: one rectangle in a layer the ward does not declare. */
const boardCells = projection({
  name: "warm.boardCells",
  layer: "cells",
  from: () => ({ id: "cells" }),
  view: () => [
    Transform({ x: 20, y: 400 }),
    Shape({ kind: "rect", w: 350, h: 50, fill: 0x30_40_50 })
  ]
});

/** The board's pause sheet, kept warm while the board rests. */
const pauseSheet = projection({
  name: "warm.pause",
  layer: "ui",
  from: (_player: Player, session: Session): Window[] =>
    session.sheet === "pause" ? [{ id: "pause" }] : [],
  key: (item: Window) => item.id,
  view: () => (
    <column key="pauseRoot" style={{ width: 390, height: 844, fill: 0xd8_e4_f4 }}>
      <button key="pauseClose" intent="close" style={{ width: 200, height: 80 }} />
    </column>
  ),
  warm: (): Window => ({ id: "pause" })
});

const wardScene = defineScene("ward", {
  bundle: "ward",
  layers: { room: {} },
  projections: [wardRoom, wardHud, settingsDim, settingsSheet, shopSheet]
});
const boardScene = defineScene("board", {
  bundle: "board",
  layers: { cells: {} },
  projections: [boardCells, pauseSheet]
});

/**
 * A node that opens a window, or closes every window for `""`, and goes back to its rest node.
 *
 * @param sheet - The window, or `""`.
 * @returns The node.
 */
function opens(sheet: string) {
  return defineNode({
    outcomes: { done: type() },
    run: ({ session, out }) => {
      session.sheet = sheet;

      return out.done();
    }
  });
}

const ward = defineNode({
  scene: "ward",
  outcomes: { settings: type(), shop: type(), close: type(), board: type() },
  rest: true,
  checkpoint: true
});
const board = defineNode({
  scene: "board",
  outcomes: { pause: type(), close: type() },
  rest: true
});
const mainFlow = defineFlow("main", {
  nodes: {
    ward,
    board,
    openSettings: opens("settings"),
    openShop: opens("shop"),
    closeWard: opens(""),
    openPause: opens("pause"),
    closeBoard: opens("")
  },
  start: "ward",
  edges: {
    ward: { settings: "openSettings", shop: "openShop", close: "closeWard", board: "board" },
    openSettings: { done: "ward" },
    openShop: { done: "ward" },
    closeWard: { done: "ward" },
    board: { pause: "openPause", close: "closeBoard" },
    openPause: { done: "board" },
    closeBoard: { done: "board" }
  }
});
const warmFeature = defineFeature("warm", {
  scenes: [wardScene, boardScene],
  projections: [wardRoom, wardHud, settingsDim, settingsSheet, shopSheet, boardCells, pauseSheet]
});

/** A running fixture: its app, its clock and its frame driver with the oracle. */
type Running = Watched & {
  app: ReturnType<ReturnType<typeof defineGameApp>["screen"]>["app"];
  /** The moment of the clock, read without moving it. */
  moment(): number;
  /** The stage root of the page's Pixi application. */
  stage(): pixi.Container;
};

const running: Running[] = [];

afterEach(async () => {
  for (const fixture of running.splice(0)) {
    fixture.oracle.expectNoMissedFrame();
    await fixture.app.stop();
  }

  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/**
 * Starts the fixture on the ward, on a fake clock, and steps until the ward's gate is open: the windows may still be
 * warming.
 *
 * @param stepMs - Milliseconds every read of the clock moves it on: 0 holds it between frames, so a frame's budget
 *   never runs out.
 * @returns The running fixture.
 */
async function open(stepMs = 0): Promise<Running> {
  const page = openPage();
  const clock = fakeClock(1000);
  const read = clock.now.bind(clock);

  // A clock that runs on with every read: the warm budget of a frame runs out after a known number of reads.
  clock.now = (): number => {
    const moment = read();

    clock.set(moment + stepMs);

    return moment;
  };
  const { app } = defineGameApp({
    flow: mainFlow,
    safeNode: "ward",
    player: { coins: 5 },
    session: { sheet: "" },
    // A 390 x 844 page at scale 1: a view's reference size is its size in pixels.
    referenceSide: 390,
    referenceLong: 844,
    features: [warmFeature],
    pluginConfigs: { log: { mode: "test" }, flow: { holdMs: 0 }, scenes: { leave: false } }
  }).screen({ manifest: MANIFEST, renderer: page.renderer, clock });

  await app.start();
  app.flow.run().catch(() => undefined);

  const fixture: Running = {
    ...watch(app, page, clock),
    app,
    moment: read,
    stage: () => page.stage.last().stage
  };

  running.push(fixture);
  await arrive(fixture, "ward");

  return fixture;
}

/**
 * Steps frames until the flow rests at a node with its gate open.
 *
 * @param fixture - The running fixture.
 * @param path - The path of the rest node.
 */
async function arrive(fixture: Running, path: string): Promise<void> {
  const { flow } = fixture.app;

  for (let frame = 0; frame < 120; frame += 1) {
    if (flow.state().path === path && flow.gate.state().open) return;
    await fixture.frames(1);
  }

  throw new Error(`The flow did not rest at "${path}".`);
}

/**
 * Every entity the world holds warm: the views of the windows (a `Tree`) and the elements `ui` made for them (each
 * draws a `Shape`), for which `isBuilding` answers.
 *
 * @param fixture - The running fixture.
 * @returns Their entities.
 */
function heldEntities(fixture: Running): World.Entity[] {
  const { world } = fixture.app;
  const held = new Set<World.Entity>();

  for (const [entity] of world.ecs.query(Tree)) {
    if (world.projection.isBuilding(entity)) held.add(entity);
  }

  for (const [entity] of world.ecs.query(Shape)) {
    if (world.projection.isBuilding(entity)) held.add(entity);
  }

  return [...held];
}

/**
 * The held view of a window: the held `Tree` entity `keyOf` answers for with the window's projection.
 *
 * @param fixture - The running fixture.
 * @param name - The projection.
 * @returns The view's entity, or `undefined` while nothing of the window is held.
 */
function heldRoot(fixture: Running, name: string): World.Entity | undefined {
  const { world } = fixture.app;

  for (const [entity] of world.ecs.query(Tree)) {
    if (
      world.projection.isBuilding(entity) &&
      world.projection.keyOf(entity)?.projection === name
    ) {
      return entity;
    }
  }

  return undefined;
}

/**
 * A held element of a window, by the key its JSX gives it: `ui.find` does not answer for it while it is held.
 *
 * @param fixture - The running fixture.
 * @param name - The projection.
 * @param key - The element's key.
 * @returns The element's entity, or `undefined`.
 */
function heldElement(fixture: Running, name: string, key: string): World.Entity | undefined {
  const { world } = fixture.app;

  return heldEntities(fixture).find(entity => {
    const address = world.projection.keyOf(entity);

    return address?.projection === name && address.key === key;
  });
}

/**
 * Tells whether the world rests with every one of these windows held and none in work.
 *
 * @param fixture - The running fixture.
 * @param names - The windows.
 * @returns True when they are all warm.
 */
function warm(fixture: Running, names: readonly string[]): boolean {
  return (
    fixture.app.world.projection.left() === Number.POSITIVE_INFINITY &&
    names.every(name => heldRoot(fixture, name) !== undefined)
  );
}

/**
 * Steps frames until these windows are warm.
 *
 * @param fixture - The running fixture.
 * @param names - The windows.
 * @param most - The most frames to step.
 * @returns How many frames it took.
 */
async function untilWarm(
  fixture: Running,
  names: readonly string[] = WARD_WINDOWS,
  most = 300
): Promise<number> {
  for (let frame = 0; frame < most; frame += 1) {
    if (warm(fixture, names)) return frame;
    await fixture.frames(1);
  }

  throw new Error(`The windows ${names.join(", ")} were not warm in ${most} frames.`);
}

/**
 * Tells whether an entity's display object hangs in the stage.
 *
 * @param fixture - The running fixture.
 * @param entity - The entity.
 * @returns True when the stage root is one of its ancestors.
 */
function onStage(fixture: Running, entity: World.Entity | undefined): boolean {
  if (entity === undefined) return false;

  const root = fixture.stage();
  let node = fixture.app.renderer.sync.displayOf(entity) as pixi.Container | undefined;

  while (node !== undefined && node !== null) {
    if (node === root) return true;
    node = node.parent ?? undefined;
  }

  return false;
}

/**
 * The entity of a keyed element of the screen.
 *
 * @param fixture - The running fixture.
 * @param key - The element's key.
 * @returns The entity, or `undefined` while no live element has the key.
 */
function find(fixture: Running, key: string): World.Entity | undefined {
  // eslint-disable-next-line unicorn/no-array-callback-reference -- `ui.find` takes a key, not a callback.
  return fixture.app.ui.find(key);
}

/**
 * Answers the gate and steps the one frame after it.
 *
 * @param fixture - The running fixture, its gate open.
 * @param intent - An outcome of the resting node.
 * @returns Whether that frame was drawn.
 */
async function answer(fixture: Running, intent: string): Promise<boolean> {
  expect(fixture.app.flow.gate.answer({ intent })).toBe(true);

  const [drawn] = await fixture.each(1);

  return drawn === true;
}

/**
 * The alpha an element is drawn with: its wrapper's, which carries the alpha of its `Shape` for its children too.
 *
 * @param fixture - The running fixture.
 * @param entity - The element.
 * @returns The alpha, or `undefined` without a display object.
 */
function alphaOf(fixture: Running, entity: World.Entity): number | undefined {
  const object = fixture.app.renderer.sync.displayOf(entity) as pixi.Container | undefined;
  const parent = object?.parent;

  return parent?.label.startsWith("parent#") === true ? parent.alpha : object?.alpha;
}

/**
 * Steps frames and reads, for each, how far its work moved the clock past the 16 ms of the frame: on a clock that
 * moves with every read, the reads of the frame.
 *
 * @param fixture - The running fixture.
 * @param count - The frames.
 * @returns The milliseconds of each frame.
 */
async function costsOf(fixture: Running, count: number): Promise<number[]> {
  const costs: number[] = [];

  for (let frame = 0; frame < count; frame += 1) {
    const before = fixture.moment();

    await fixture.frames(1);
    costs.push(fixture.moment() - before - FRAME_MS);
  }

  return costs;
}

/**
 * The Pixi tree under a node, one line per node, the entity numbers of the labels left out.
 *
 * @param node - The node.
 * @param depth - Its depth.
 * @returns The lines.
 */
function describeTree(node: pixi.Container, depth = 0): string[] {
  // A label Pixi leaves unset reads `null`.
  const label = String(node.label ?? "").replaceAll(/#\d+/g, "#");
  const line = `${" ".repeat(depth)}${node.constructor.name} ${label} ${node.x},${node.y} z${node.zIndex} a${node.alpha} ${node.visible ? "shown" : "hidden"}`;

  return [line, ...node.children.flatMap(child => describeTree(child, depth + 1))];
}

describe("warm windows, across the engine", () => {
  // Bug: a window is built in the frame of the open (the long frame this change exists for) or in one long resting
  // frame; a held view is drawn, found or hit while its window is closed.
  it("warms the windows over several resting frames under the budget, none of them drawn, found or hit", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);

    const fixture = await open(1);
    const { app } = fixture;
    const budget = ((1000 / app.time.rate().fps) * 2) / 3;
    const adopted: number[] = [];
    const adopt = app.world.projection.adopt;

    vi.spyOn(app.world.projection, "adopt").mockImplementation(entity => {
      adopted.push(app.time.snapshot().frame);
      adopt(entity);
    });

    const costs: number[] = [];
    const door = find(fixture, "wardSettings");

    while (!warm(fixture, WARD_WINDOWS) && costs.length < 300) {
      costs.push(...(await costsOf(fixture, 1)));

      // Nothing of a closed window is on the stage, found or hit.
      expect(heldEntities(fixture).filter(entity => onStage(fixture, entity))).toEqual([]);
      expect(find(fixture, "settingsClose")).toBeUndefined();
      expect(find(fixture, `shopRow${SHOP_ROWS - 1}b`)).toBeUndefined();
      expect(app.world.projection.entityOf("warm.shop", "shop")).toBeUndefined();
      expect(app.renderer.sync.hitAll(TOP_BUTTON.x, TOP_BUTTON.y)[0]).toBe(door);
    }

    expect(warm(fixture, WARD_WINDOWS)).toBe(true);

    // What a resting frame with nothing to warm reads of the clock.
    const rest = await costsOf(fixture, 3);

    // Every element `ui` made for the windows came over several frames, and no frame read the clock for much more than
    // the budget past a resting frame.
    expect(adopted.length).toBeGreaterThanOrEqual(SHOP_ELEMENTS - 1);
    expect(new Set(adopted).size).toBeGreaterThanOrEqual(3);
    expect(Math.max(...costs)).toBeLessThanOrEqual(Math.max(...rest) + budget + OVERRUN_MS);
    expect(app.log.trace().filter(entry => entry.event === "renderer:building-drawn")).toEqual([]);
  });

  // Bug: the answer that opens a warm sheet builds a new view (the wait the warm exists to take away), shows it a
  // frame late, skips its enter, or leaves it unfound or unhit.
  it("shows the held settings sheet and its dim in the next frame, the same view, its enter started, found and hit", async () => {
    const fixture = await open();
    const { app } = fixture;

    await untilWarm(fixture);

    const view = heldRoot(fixture, "warm.settings");
    const dimView = heldRoot(fixture, "warm.settingsDim");
    const root = heldElement(fixture, "warm.settings", "settingsRoot") ?? 0;
    const dim = heldElement(fixture, "warm.settingsDim", "settingsDim") ?? 0;
    const held = app.renderer.sync.displayOf(root);
    const entities = app.world.ecs.count();

    expect(held).toBeDefined();
    expect(await answer(fixture, "settings")).toBe(true);

    // The next frame: the held view is the open one, on the stage, nothing spawned for it, its fade-in under way.
    expect(app.world.projection.entityOf("warm.settings", "settings")).toBe(view);
    expect(app.world.projection.entityOf("warm.settingsDim", "dim")).toBe(dimView);
    expect([find(fixture, "settingsRoot"), find(fixture, "settingsDim")]).toEqual([root, dim]);
    expect(app.renderer.sync.displayOf(root)).toBe(held);
    expect([onStage(fixture, root), onStage(fixture, dim)]).toEqual([true, true]);
    expect(app.world.ecs.count()).toBe(entities);
    expect(app.world.projection.motionsOf(root)).toEqual(["Shape"]);
    expect(alphaOf(fixture, root)).toBeLessThan(1);

    const close = find(fixture, "settingsClose");

    expect(onStage(fixture, close)).toBe(true);

    // Once it faded in (a view at alpha 0 takes no tap), a tap at the ward's settings button lands on its close button.
    await fixture.frames(20);
    expect(alphaOf(fixture, root)).toBe(1);
    expect(app.renderer.sync.hitAll(TOP_BUTTON.x, TOP_BUTTON.y)[0]).toBe(close);

    app.input.tap(close ?? 0);
    await fixture.frames(2);
    expect(app.flow.state().path).toBe("ward");
    expect(app.world.projection.entitiesOf("warm.settings")).toEqual([]);
  });

  // Bug: a big warm window is shown in parts after the open, or built again in the open's frame.
  it("opens the warm shop of 599 elements whole in the next frame", async () => {
    const fixture = await open();
    const { app } = fixture;

    await untilWarm(fixture);

    const view = heldRoot(fixture, "warm.shop");
    const entities = app.world.ecs.count();

    expect(await answer(fixture, "shop")).toBe(true);

    const rows = Array.from({ length: SHOP_ROWS }, (_unused, index) =>
      find(fixture, `shopRow${index}b`)
    );
    const last = app.renderer.sync.displayOf(rows.at(-1) ?? 0) as pixi.Container | undefined;

    expect(app.world.projection.entityOf("warm.shop", "shop")).toBe(view);
    expect(app.world.ecs.count()).toBe(entities);
    expect(rows.filter(row => !onStage(fixture, row))).toEqual([]);
    expect(last?.visible).toBe(true);
    expect(rows.filter(row => app.world.projection.isBuilding(row ?? 0))).toEqual([]);
    expect(heldRoot(fixture, "warm.shop")).toBeUndefined();
  });

  // Bug: a closed window is not warmed again (the second open builds it in its frame), or its exit is cut.
  it("plays the exit at the close, warms the window again, and a reopen 0.5 s later shows in the next frame", async () => {
    const fixture = await open();
    const { app } = fixture;

    await untilWarm(fixture);
    await answer(fixture, "settings");
    await fixture.frames(20);

    const first = find(fixture, "settingsRoot") ?? 0;
    const closedAt = fixture.moment();

    await answer(fixture, "close");
    await fixture.frames(2);

    // The exit plays: the sheet is still on the stage and fading.
    expect(onStage(fixture, first)).toBe(true);
    expect(alphaOf(fixture, first)).toBeLessThan(1);

    while (fixture.moment() - closedAt < 500) await fixture.frames(1);

    const view = heldRoot(fixture, "warm.settings");
    const second = heldElement(fixture, "warm.settings", "settingsRoot");

    expect(app.world.ecs.ownerOf(first)).toBeUndefined();
    expect(warm(fixture, WARD_WINDOWS)).toBe(true);
    expect(onStage(fixture, second)).toBe(false);

    const entities = app.world.ecs.count();

    await answer(fixture, "settings");

    expect(app.world.projection.entityOf("warm.settings", "settings")).toBe(view);
    expect(find(fixture, "settingsRoot")).toBe(second);
    expect(onStage(fixture, second)).toBe(true);
    expect(onStage(fixture, find(fixture, "settingsClose"))).toBe(true);
    expect(app.world.ecs.count()).toBe(entities);
  });

  // Bug: the ward's held views outlive the switch (entities and Pixi objects left behind), or the board's windows are
  // warmed during the build (held by the build's readiness) or never.
  it("drops the ward's held windows at a switch and warms the board's after its swap", async () => {
    const fixture = await open();
    const { app } = fixture;

    await untilWarm(fixture);

    const wardHeld = heldEntities(fixture);

    expect(wardHeld.length).toBeGreaterThanOrEqual(SHOP_ELEMENTS);
    expect(app.flow.gate.answer({ intent: "board" })).toBe(true);

    const pauseBefore: boolean[] = [];

    for (let frame = 0; frame < 120 && app.scenes.current() !== "board"; frame += 1) {
      await fixture.frames(1);
      if (app.scenes.current() !== "board") {
        pauseBefore.push(heldRoot(fixture, "warm.pause") !== undefined);
      }
    }

    expect(pauseBefore.filter(Boolean)).toEqual([]);
    await arrive(fixture, "board");
    await untilWarm(fixture, ["warm.pause"]);

    expect(wardHeld.filter(entity => app.world.ecs.ownerOf(entity) !== undefined)).toEqual([]);
    expect(wardHeld.filter(entity => app.renderer.sync.displayOf(entity) !== undefined)).toEqual(
      []
    );

    const pause = heldElement(fixture, "warm.pause", "pauseRoot");

    expect(onStage(fixture, pause)).toBe(false);
    await answer(fixture, "pause");
    expect(find(fixture, "pauseRoot")).toBe(pause);
    expect(onStage(fixture, pause)).toBe(true);
  });

  // Bug: a restore in the middle of a warm leaves the held view or its parts behind, or the world never warms again,
  // or ends in another screen than a world that never restored.
  it("a restore in the middle of the warm leaves no held view, and the world converges", async () => {
    const fixture = await open(1);
    const { app } = fixture;
    const bookmark = app.flow.bookmark();

    for (let frame = 0; frame < 120 && heldEntities(fixture).length < 50; frame += 1) {
      await fixture.frames(1);
    }

    const before = heldEntities(fixture);

    expect(app.world.projection.left()).toBeLessThan(Number.POSITIVE_INFINITY);
    expect(warm(fixture, WARD_WINDOWS)).toBe(false);

    await app.flow.restore(bookmark);

    await arrive(fixture, "ward");
    await untilWarm(fixture);

    expect(before.filter(entity => app.renderer.sync.displayOf(entity) !== undefined)).toEqual([]);

    const fresh = await open(1);

    await untilWarm(fresh);
    await fixture.frames(5);
    await fresh.frames(5);

    expect(app.world.ecs.count()).toBe(fresh.app.world.ecs.count());
    expect(app.renderer.stats().views).toEqual(fresh.app.renderer.stats().views);
    expect(app.ui.tree()).toEqual(fresh.app.ui.tree());
    expect(describeTree(fixture.stage())).toEqual(describeTree(fresh.stage()));

    const entities = app.world.ecs.count();

    await answer(fixture, "settings");
    expect(onStage(fixture, find(fixture, "settingsClose"))).toBe(true);
    expect(app.world.ecs.count()).toBe(entities);
  });
});
