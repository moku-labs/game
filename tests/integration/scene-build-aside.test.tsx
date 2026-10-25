/**
 * @file Root integration — the next scene built aside (spec 31, F61 S2): flow, scenes, world, ui, renderer, assets
 * and time together. The real screen set on the fake page, over Pixi's own display objects (`drawn-helpers.ts`), on a
 * fake clock, with `scenes.buildMs: 1`; every board sprite's texture costs 1 ms of that clock, so the renderer makes
 * one board view a frame and the switch builds over several frames. The ward stays current, drawn and hit until the
 * commit, the board is hung in one frame, and the screen it ends on is the one a one-block switch ends on. An abort
 * in the middle of the build leaves the world as it stood. The tree oracle checks every frame.
 */
import type { Assets, World } from "@moku-labs/game";
import { defineGame, Shape, Sprite, Transform, type } from "@moku-labs/game";
import { defineGameApp } from "@moku-labs/game/app";
import { fakeClock } from "@moku-labs/game/testing";
import * as pixi from "pixi.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openPage, type Watched, watch } from "./drawn-helpers";

const { defineNode, defineFlow, defineFeature, defineScene, projection } = defineGame<{
  player: { n: number };
  session: Record<string, never>;
  assets: string;
  scenes: "ward" | "board";
  strings: Record<string, never>;
}>();

/** Both scene bundles hold no file. */
const MANIFEST: Assets.Manifest = {
  version: 2,
  bundles: {
    ward: { feature: "aside", tier: "lazy", mb: 0, files: [] },
    board: { feature: "aside", tier: "lazy", mb: 0, files: [] }
  }
};

/** The texture key of the board's cells: the test's provider charges 1 ms of the clock for each. */
const CELL = "board.cell";

/** The board's cells: six sprites, so the board builds over at least six frames. */
const CELLS = ["c1", "c2", "c3", "c4", "c5", "c6"] as const;

/** The ward's room: one rectangle in its own layer. */
const wardRoom = projection({
  name: "aside.wardRoom",
  layer: "room",
  from: () => ({ id: "room" }),
  view: () => [Transform({ x: 0, y: 0 }), Shape({ kind: "rect", w: 390, h: 844, fill: 0x9f_b7_b4 })]
});

/** The ward's HUD: a JSX root with the door to the board. */
const wardHud = projection({
  name: "aside.wardHud",
  layer: "ui",
  from: () => ({ id: "hud" }),
  view: () => (
    <column key="wardHud" style={{ width: 390, height: 844 }}>
      <button key="wardDoor" intent="board" style={{ width: 200, height: 80 }} />
    </column>
  )
});

/** The board's cells, in a layer the ward does not declare. */
const boardCells = projection({
  name: "aside.boardCells",
  layer: "cells",
  from: () => CELLS.map((id, index) => ({ id, x: 20 + index * 60 })),
  key: (cell: { id: string }) => cell.id,
  view: (cell: { id: string; x: number }) => [
    Transform({ x: cell.x, y: 400 }),
    Sprite({ texture: CELL, width: 50, height: 50 })
  ]
});

/** The board's panel: a JSX root with the button a player taps first. */
const boardPanel = projection({
  name: "aside.boardPanel",
  layer: "ui",
  from: () => ({ id: "panel" }),
  view: () => (
    <column key="boardPanel" style={{ width: 390, height: 844 }}>
      <button key="boardPlay" intent="back" style={{ width: 200, height: 80 }} />
    </column>
  )
});

const wardScene = defineScene("ward", {
  bundle: "ward",
  layers: { room: {} },
  projections: [wardRoom, wardHud]
});
const boardScene = defineScene("board", {
  bundle: "board",
  layers: { cells: {} },
  projections: [boardCells, boardPanel]
});
const ward = defineNode({
  scene: "ward",
  outcomes: { board: type() },
  rest: true,
  checkpoint: true
});
const board = defineNode({ scene: "board", outcomes: { back: type() }, rest: true });
const mainFlow = defineFlow("main", {
  nodes: { ward, board },
  start: "ward",
  edges: { ward: { board: "board" }, board: { back: "ward" } }
});
const asideFeature = defineFeature("aside", {
  scenes: [wardScene, boardScene],
  projections: [wardRoom, wardHud, boardCells, boardPanel]
});

/** The projections of both scenes, by name. */
const NAMES = ["aside.wardRoom", "aside.wardHud", "aside.boardCells", "aside.boardPanel"] as const;

/** A display object as the test reads it. */
type Node = pixi.Container;

/** A running fixture: its app and its frame driver with the oracle. */
type Running = Watched & {
  app: ReturnType<ReturnType<typeof defineGameApp>["screen"]>["app"];
  /** The stage root of the page's Pixi application. */
  stage(): Node;
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
 * Starts the fixture on the ward, on a fake clock, and steps until the ward stands.
 *
 * @returns The running fixture, the ward drawn and its gate open.
 */
async function open(): Promise<Running> {
  const page = openPage();
  const clock = fakeClock(1000);
  const cell = new pixi.Texture({ source: new pixi.TextureSource({ width: 64, height: 64 }) });
  const { app } = defineGameApp({
    flow: mainFlow,
    safeNode: "ward",
    player: { n: 0 },
    session: {},
    // A 390 x 844 page at scale 1: a view's reference size is its size in pixels.
    referenceSide: 390,
    referenceLong: 844,
    features: [asideFeature],
    pluginConfigs: { log: { mode: "test" }, flow: { holdMs: 0 }, scenes: { buildMs: 1 } }
  }).screen({ manifest: MANIFEST, renderer: page.renderer, clock });

  await app.start();
  // Each board cell costs 1 ms of the frame: with `buildMs: 1` the renderer makes one of them a frame.
  app.renderer.sync.textures.provide(key => {
    if (key !== CELL) return undefined;

    clock.advance(1);

    return cell as never;
  });
  app.flow.run().catch(() => undefined);

  const fixture: Running = {
    ...watch(app, page, clock),
    app,
    stage: () => page.stage.last().stage
  };

  running.push(fixture);
  await arrive(fixture, "ward");
  await fixture.frames(5);

  return fixture;
}

/**
 * Steps frames until the flow rests at a node with its gate open: a live switch opens it after the commit.
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
 * The Pixi tree under a node, one line per node, the entity numbers of the labels left out: what the player sees and
 * how it is nested.
 *
 * @param node - The node.
 * @param depth - Its depth.
 * @returns The lines.
 */
function describeTree(node: Node, depth = 0): string[] {
  // A label Pixi leaves unset reads `null`.
  const label = String(node.label ?? "").replaceAll(/#\d+/g, "#");
  const line = `${" ".repeat(depth)}${node.constructor.name} ${label} ${node.x},${node.y} z${node.zIndex} a${node.alpha} ${node.visible ? "shown" : "hidden"}`;

  return [line, ...node.children.flatMap(child => describeTree(child, depth + 1))];
}

/**
 * Tells whether an entity's display object hangs in the stage.
 *
 * @param fixture - The running fixture.
 * @param entity - The entity.
 * @returns True when the stage root is one of its ancestors.
 */
function onStage(fixture: Running, entity: World.Entity): boolean {
  const root = fixture.stage();
  let node = fixture.app.renderer.sync.displayOf(entity) as Node | undefined;

  while (node !== undefined && node !== null) {
    if (node === root) return true;
    node = node.parent ?? undefined;
  }

  return false;
}

/**
 * The board's cell entities, building or mounted.
 *
 * @param fixture - The running fixture.
 * @returns The entities, in key order.
 */
function cellsOf(fixture: Running): readonly World.Entity[] {
  return fixture.app.world.projection.entitiesOf("aside.boardCells");
}

/**
 * Switches from the ward to the board and steps until the commit, recording each build frame.
 *
 * @param fixture - The running fixture, at the ward.
 * @returns What every frame before the commit showed.
 */
async function switchToBoard(fixture: Running) {
  const { app } = fixture;
  const frames: Array<{ current: string | undefined; tree: string[]; cellsOnStage: number }> = [];

  expect(app.flow.gate.answer({ intent: "board" })).toBe(true);

  for (let frame = 0; frame < 120 && app.scenes.current() !== "board"; frame += 1) {
    await fixture.frames(1);

    if (app.scenes.current() === "board") break;

    frames.push({
      current: app.scenes.current(),
      tree: describeTree(fixture.stage()),
      cellsOnStage: cellsOf(fixture).filter(entity => onStage(fixture, entity)).length
    });
  }

  expect(app.scenes.current()).toBe("board");

  return frames;
}

describe("the next scene built aside, across the engine", () => {
  // Bug: the board is drawn, current or hit before it is whole (the jank and the flash this change exists for), it
  // hangs in pieces over several frames, or a build does not end in the same screen as a one-block switch.
  it("builds over several frames with the ward current and drawn, swaps in one frame, and ends as a one-block switch", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);

    const aside = await open();
    const wardTree = describeTree(aside.stage());
    const built = await switchToBoard(aside);

    // Several frames, the ward current and drawn as it was, no board view on the stage, no tap on the board.
    expect(built.length).toBeGreaterThanOrEqual(CELLS.length);
    expect(built.every(frame => frame.current === "ward")).toBe(true);
    expect(built.every(frame => frame.cellsOnStage === 0)).toBe(true);
    expect(built.filter(frame => frame.tree.join("\n") !== wardTree.join("\n"))).toEqual([]);

    // The commit frame: the board is current, nothing of it is hung yet; the swap frame hangs all of it at once.
    expect(cellsOf(aside).filter(entity => onStage(aside, entity))).toEqual([]);
    await aside.frames(1);
    expect(cellsOf(aside).filter(entity => onStage(aside, entity))).toHaveLength(CELLS.length);
    expect(onStage(aside, aside.app.ui.find("boardPlay") ?? 0)).toBe(true);

    // The one-block switch of the same game: the world refuses the build, as for a projection on other layer rules.
    const oneBlock = await open();

    vi.spyOn(oneBlock.app.world.projection, "build").mockReturnValue(false);
    oneBlock.app.flow.gate.answer({ intent: "board" });
    await arrive(oneBlock, "board");
    await arrive(aside, "board");
    await aside.frames(30);
    await oneBlock.frames(30);

    expect(aside.app.ui.tree()).toEqual(oneBlock.app.ui.tree());
    expect(describeTree(aside.stage())).toEqual(describeTree(oneBlock.stage()));
    // The dev check of the renderer stayed silent through the build.
    expect(
      aside.app.log.trace().filter(entry => entry.event === "renderer:building-drawn")
    ).toEqual([]);
  });

  // Bug: a tap during the build lands on a view of the coming scene, which is not drawn.
  it("hits the ward's door under the board's button until the commit, and the button after it", async () => {
    const fixture = await open();
    const { app } = fixture;
    const door = app.ui.find("wardDoor") ?? 0;

    app.flow.gate.answer({ intent: "board" });
    await fixture.frames(2);

    const during = app.renderer.sync.hitAll(100, 40);

    expect(app.scenes.current()).toBe("ward");
    expect(during).toContain(door);
    expect(during.filter(entity => app.world.projection.isBuilding(entity))).toEqual([]);

    await arrive(fixture, "board");
    await fixture.frames(1);

    expect(app.renderer.sync.hitAll(100, 40)).toContain(app.ui.find("boardPlay"));
  });

  // Bug: an abort in the middle of the build (a restore) leaves the board's entities or views behind, keeps its
  // layers, its mounted list or its bundles held, or moves the ward.
  it("an abort in the middle of the build leaves the world as it stood", async () => {
    const fixture = await open();
    const { app } = fixture;
    const coming = vi.spyOn(app.assets, "sceneComing");
    const named = vi.spyOn(app.assets, "sceneBundles");
    const bookmark = app.flow.bookmark();
    const before = {
      entities: app.world.ecs.count(),
      tree: app.ui.tree(),
      views: app.renderer.stats().views,
      layers: app.world.projection.layers(),
      mounted: NAMES.map(name => app.world.projection.entitiesOf(name).length),
      stage: describeTree(fixture.stage())
    };

    app.flow.gate.answer({ intent: "board" });
    await fixture.frames(3);

    const building = cellsOf(fixture);

    expect(app.scenes.current()).toBe("ward");
    expect(building).toHaveLength(CELLS.length);

    await app.flow.restore(bookmark);
    await arrive(fixture, "ward");
    await fixture.frames(5);

    expect({
      entities: app.world.ecs.count(),
      tree: app.ui.tree(),
      views: app.renderer.stats().views,
      layers: app.world.projection.layers(),
      mounted: NAMES.map(name => app.world.projection.entitiesOf(name).length),
      stage: describeTree(fixture.stage())
    }).toEqual(before);
    expect(app.scenes.current()).toBe("ward");
    expect(building.filter(entity => app.world.ecs.ownerOf(entity) !== undefined)).toEqual([]);
    expect(building.filter(entity => app.renderer.sync.displayOf(entity) !== undefined)).toEqual(
      []
    );
    expect(coming.mock.calls).toEqual([[["board"]], [[]]]);
    expect(named).not.toHaveBeenCalled();
  });
});
