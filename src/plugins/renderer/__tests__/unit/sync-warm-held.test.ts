import { afterEach, describe, expect, it, vi } from "vitest";
import { Layer, Order } from "../../../world/ecs/define";
import { projection } from "../../../world/projection/define";
import type { AnyProjectionSpec } from "../../../world/projection/types";
import type { AnyComponentValue, Entity, LayerSpec } from "../../../world/types";
import { Parent, Sprite, Transform } from "../../components";
import type { PixiContainer } from "../../types";
import { FakeTexture } from "../fake-pixi";
import { createMockRenderer, type MockRenderer } from "../mock-renderer";

// ---------------------------------------------------------------------------
// Unit test of the held views of warm windows (spec 33, slice B+D) in the renderer's sync: world keeps the view of a
// closed window built and flagged building for as long as it rests, possibly the whole session. Its top stays off
// the stage and asks for no frame; the pass attaches it when world's membership version moves and the entity is no
// longer building (the open), in the same pass, and a scene build's held tops behind or before it still attach at
// their commit.
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const owner = { kind: "plugin", name: "test" } as const;

/** The layers of the scene on screen: the windows hang in `ui`, sorted by order. */
const SCENE: readonly LayerSpec[] = [{ name: "ui", sort: "order" }];

/** The layers of a coming scene that keeps the windows: the scene's, and a board it adds. */
const COMING: readonly LayerSpec[] = [
  { name: "ui", sort: "order" },
  { name: "board", sort: "order" }
];

/** The settings sheet: the first warm window. */
const SETTINGS = "settings.sheet";

/** The shop: the second warm window, mounted after the settings sheet. */
const SHOP = "shop.sheet";

/** What a view of the tests draws: a 64 x 64 texture. */
const texture = new FakeTexture({});

/** One item of a window: its key and where it sits. */
type Sheet = { id: string; x: number };

/**
 * A warm window: `from` shows its item while `open` names it; `warm` is the same item, so world keeps its view built
 * and held while it is closed.
 *
 * @param name - The projection, also the key of its item.
 * @param open - The windows `from` shows now.
 * @returns The spec.
 */
function sheet(name: string, open: ReadonlySet<string>): AnyProjectionSpec {
  const item: Sheet = { id: name, x: 540 };

  return projection({
    name,
    layer: "ui",
    from: (): Sheet[] => (open.has(name) ? [item] : []),
    key: (shown: Sheet) => shown.id,
    view: (shown: Sheet) => [Transform({ x: shown.x, y: 300 }), Sprite({ texture: "sheet" })],
    warm: (): Sheet => item
  }) as unknown as AnyProjectionSpec;
}

/** A started renderer with warm windows mounted, and the switch of what `from` shows. */
type Windows = { mock: MockRenderer; open: Set<string> };

/**
 * One frame: world's input step (the frame start, the reconcile of a marked commit, one warm step), the sync pass,
 * the change sets closed, the render phase.
 *
 * @param mock - The mock renderer.
 */
function frame(mock: MockRenderer): void {
  mock.runPhase("input");
  mock.world.startFrame();
  mock.world.input();
  mock.modules.sync.pass();
  mock.world.clearChanges();
  mock.runPhase("render");
}

/** The board the windows open over: a live projection that shows one cell, so world's membership version moved. */
const board = projection({
  name: "board",
  layer: "ui",
  from: (): Sheet[] => [{ id: "cell", x: 100 }],
  key: (cell: Sheet) => cell.id,
  view: (cell: Sheet) => [Transform({ x: cell.x, y: 100 }), Sprite({ texture: "board" })]
}) as unknown as AnyProjectionSpec;

/**
 * Starts a mock renderer on the scene showing the board, and mounts closed warm windows after it: no frame runs yet.
 *
 * @param names - The windows, in mount order.
 * @returns The started renderer and the switch of what `from` shows.
 */
async function mountWindows(names: readonly string[]): Promise<Windows> {
  const mock = createMockRenderer();
  const open = new Set<string>();

  await mock.start();
  mock.api.sync.textures.provide(() => texture as never);
  mock.world.projection.setLayers(SCENE);
  mock.world.projection.register(board);
  for (const name of names) mock.world.projection.register(sheet(name, open));
  mock.world.projection.mount(["board", ...names], owner);

  return { mock, open };
}

/**
 * Starts a mock renderer on the scene, mounts closed warm windows and runs the frames that build each one aside and
 * leave it ready: a spawn and a poll per window, then the step that finds no more work.
 *
 * @param names - The windows, in mount order.
 * @returns The started renderer and the switch of what `from` shows.
 */
async function warmWindows(names: readonly string[] = [SETTINGS]): Promise<Windows> {
  const { mock, open } = await mountWindows(names);

  for (let index = 0; index <= names.length * 2; index += 1) frame(mock);

  expect(mock.world.projection.left()).toBe(Number.POSITIVE_INFINITY);

  return { mock, open };
}

/**
 * The entity world holds for a window: the root its warm step spawned.
 *
 * @param mock - The mock renderer.
 * @param name - The window.
 * @returns The entity.
 */
function heldOf(mock: MockRenderer, name: string): Entity {
  for (const [entity] of mock.world.ecs.query(Layer)) {
    if (mock.world.projection.keyOf(entity)?.projection === name) return entity;
  }

  throw new Error(`no held view of ${name}`);
}

/**
 * Opens or closes windows as a commit of the session does: the next frame's reconcile reads `from`.
 *
 * @param windows - The renderer and the switch.
 * @param names - The windows shown from now.
 */
function show(windows: Windows, names: readonly string[]): void {
  windows.open.clear();
  for (const name of names) windows.open.add(name);
  windows.mock.world.commitSession();
}

/**
 * The display object of an entity's view.
 *
 * @param mock - The mock renderer.
 * @param entity - The entity.
 * @returns Its object.
 */
function objectOf(mock: MockRenderer, entity: Entity): PixiContainer {
  const object = mock.api.sync.displayOf(entity) as PixiContainer | undefined;

  if (object === undefined) throw new Error(`no view for ${entity}`);

  return object;
}

/**
 * Tells whether an entity's view hangs under the stage.
 *
 * @param mock - The mock renderer.
 * @param entity - The entity.
 * @returns True when the stage is one of its ancestors.
 */
function onStage(mock: MockRenderer, entity: Entity): boolean {
  const stage = mock.pixi.last().stage as unknown as PixiContainer;

  for (let parent = objectOf(mock, entity).parent; parent !== null; parent = parent.parent) {
    if (parent === stage) return true;
  }

  return false;
}

/**
 * Where an entity's view is: under the stage, made but off it, or not made yet.
 *
 * @param mock - The mock renderer.
 * @param entity - The entity.
 * @returns `"stage"`, `"off"` or `"none"`.
 */
function placeOf(mock: MockRenderer, entity: Entity): "stage" | "off" | "none" {
  if (mock.api.sync.displayOf(entity) === undefined) return "none";

  return onStage(mock, entity) ? "stage" : "off";
}

/**
 * Makes every view creation spend more of the world clock than a frame's warm budget: the provider moves it on 50 ms.
 *
 * @param mock - The mock renderer.
 */
function slowViews(mock: MockRenderer): void {
  let now = 0;

  mock.api.sync.textures.provide(() => {
    now += 50;
    mock.setWorldNow(now);

    return texture as never;
  });
}

/**
 * The entities of the held list, in its order.
 *
 * @param mock - The mock renderer.
 * @returns The listed entities.
 */
function heldList(mock: MockRenderer): Entity[] {
  const held = mock.ctx.state.sync.heldViews;

  return held.entities.slice(0, held.count);
}

/**
 * A sprite top of the coming board at an order.
 *
 * @param order - Its `Order`.
 * @returns Its components.
 */
function boardTop(order: number): AnyComponentValue[] {
  return [
    Layer({ name: "board" }),
    Transform({ x: order * 100 }),
    Sprite({ texture: "board.cell" }),
    Order({ value: order })
  ];
}

describe("warm windows: a held top at rest", () => {
  // Bug: a closed window's top asks for the next frame on every tick for as long as it rests (the canvas is drawn at
  // the full rate and the loop never sleeps), or the pass takes its live half again every frame for it.
  it("stays detached across many frames, asks for no frame and keeps the pass still", async () => {
    const { mock } = await warmWindows();
    const held = heldOf(mock, SETTINGS);
    const request = vi.spyOn(mock.modules.demand, "request");
    const version = mock.ctx.state.sync.passesVersion;

    for (let index = 0; index < 30; index += 1) frame(mock);

    expect(mock.world.projection.isBuilding(held)).toBe(true);
    expect(onStage(mock, held)).toBe(false);
    expect(heldList(mock)).toEqual([held]);
    expect(request).not.toHaveBeenCalled();
    expect(mock.ctx.state.sync.passesVersion).toBe(version);
  });

  // Bug: the first top of an empty held list keeps a version world has moved past: the next frame scans a list of
  // building views and takes the live half of the pass, so the live scene's walks and render passes are counted again.
  it("keeps the frame after the window's view is made and held still", async () => {
    const { mock } = await mountWindows([SETTINGS]);

    // The spawn of the window and the frame that makes its view aside and holds it.
    frame(mock);

    const version = mock.ctx.state.sync.passesVersion;

    // The poll that finds the window ready.
    frame(mock);

    expect(heldList(mock)).toEqual([heldOf(mock, SETTINGS)]);
    expect(mock.ctx.state.sync.passesVersion).toBe(version);
  });

  // Bug: the dev check of a build frame walks every view and makes a list on every frame of the rest: a dev or agent
  // build pays per view for a window nobody builds.
  it("runs the dev check of building views in no frame of the rest", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);

    const { mock } = await warmWindows();
    const asked = vi.spyOn(mock.world.projection, "isBuilding");

    for (let index = 0; index < 5; index += 1) frame(mock);

    expect(asked).not.toHaveBeenCalled();
  });

  // Bug: a tap on the board lands on the closed settings sheet that lies over it.
  it("is never hit while it rests, and is hit once it opens", async () => {
    const windows = await warmWindows();
    const { mock } = windows;
    const under = mock.world.ecs.spawn(owner, [
      Layer({ name: "ui" }),
      Transform({ x: 540, y: 300 }),
      Sprite({ texture: "board" }),
      Order({ value: -10 })
    ]);

    frame(mock);
    frame(mock);

    expect(mock.api.sync.hitTest(540, 300, () => true)).toBe(under);

    show(windows, [SETTINGS]);
    frame(mock);

    expect(mock.api.sync.hitTest(540, 300, () => true)).toBe(heldOf(mock, SETTINGS));
  });
});

describe("warm windows: the release by membership version", () => {
  // Bug: the pass asks only the first slot of the held list whether its build ended: the shop, opened while the
  // settings sheet before it rests, stays hidden for good; or a released slot stays listed and the list grows; or the
  // scan keeps no version, so the window left resting is scanned again with the live half of the pass every frame.
  it("attaches the window world shows in the same pass and compacts the list in place", async () => {
    const windows = await warmWindows([SETTINGS, SHOP]);
    const { mock } = windows;
    const settings = heldOf(mock, SETTINGS);
    const shop = heldOf(mock, SHOP);
    const list = mock.ctx.state.sync.heldViews.entities;

    expect(heldList(mock)).toEqual([settings, shop]);

    show(windows, [SHOP]);
    frame(mock);

    expect(onStage(mock, shop)).toBe(true);
    expect(objectOf(mock, shop).parent).toBe(mock.modules.sync.layerContainer("ui"));
    expect(onStage(mock, settings)).toBe(false);
    expect(heldList(mock)).toEqual([settings]);
    expect(mock.ctx.state.sync.heldViews.entities).toBe(list);

    // The warm step after the open's reconcile looks at the records once more; then the scene rests.
    frame(mock);

    const version = mock.ctx.state.sync.passesVersion;

    for (let index = 0; index < 5; index += 1) frame(mock);

    expect(mock.ctx.state.sync.passesVersion).toBe(version);

    show(windows, [SETTINGS, SHOP]);
    frame(mock);

    expect(onStage(mock, settings)).toBe(true);
    expect(heldList(mock)).toEqual([]);
  });

  // Bug: a scene build's held tops listed behind a resting window are never attached (its first slot builds for
  // good), or the commit attaches the resting window with them and the closed sheet shows over the new scene.
  it("attaches a scene build's tops at its commit and keeps the resting window held, then attaches it at its open", async () => {
    const windows = await warmWindows();
    const { mock } = windows;
    const settings = heldOf(mock, SETTINGS);

    expect(mock.world.projection.build([SETTINGS], owner, COMING, 4)).toBe(true);

    const tops = [boardTop(1), boardTop(2)].map(components => {
      const entity = mock.world.ecs.spawn(owner, components);

      mock.world.projection.adopt(entity);

      return entity;
    });

    frame(mock);
    frame(mock);

    expect(heldList(mock)).toEqual([settings, ...tops]);

    mock.world.projection.setLayers(COMING);
    mock.world.projection.commit();
    frame(mock);

    for (const top of tops) expect(onStage(mock, top)).toBe(true);
    expect(onStage(mock, settings)).toBe(false);
    expect(heldList(mock)).toEqual([settings]);

    show(windows, [SETTINGS]);
    frame(mock);

    expect(onStage(mock, settings)).toBe(true);
    expect(heldList(mock)).toEqual([]);
  });

  // Bug: the open attaches the window's top in its pass, while the rows still waiting aside are handed to the live pass
  // only after it: the window is drawn half-built for one frame, its top on the stage without its rows.
  it("hangs every view of a window opened while it is built under the stage in the frame of the open", async () => {
    const windows = await mountWindows([SETTINGS]);
    const { mock } = windows;

    // The spawn of the window: its top is made aside and held.
    frame(mock);

    const top = heldOf(mock, SETTINGS);
    const rows = [0, 1, 2, 3, 4, 5].map(index => {
      const row = mock.world.ecs.spawn(owner, [
        Transform({ y: index * 40 }),
        Sprite({ texture: `sheet.row${index}` }),
        Parent({ entity: top })
      ]);

      mock.world.projection.adopt(row);

      return row;
    });

    slowViews(mock);
    // The budget is spent after one row.
    frame(mock);

    const built = rows.map(row => placeOf(mock, row));

    expect(built).toEqual(["off", "none", "none", "none", "none", "none"]);

    show(windows, [SETTINGS]);
    frame(mock);

    expect(placeOf(mock, top)).toBe("stage");
    expect(rows.map(row => placeOf(mock, row))).toEqual(rows.map(() => "stage"));
  });

  // Bug: the open of a window during a scene build hands the build's views still aside to the live pass with the
  // window's, or drops them from the queue: the coming scene shows before its commit, or misses views after it.
  it("keeps a scene build's views still aside building through the open of a window, and hangs them at the commit", async () => {
    const windows = await warmWindows();
    const { mock } = windows;
    const settings = heldOf(mock, SETTINGS);

    expect(mock.world.projection.build([SETTINGS], owner, COMING, 4)).toBe(true);

    const tops = [boardTop(1), boardTop(2), boardTop(3)].map(components => {
      const entity = mock.world.ecs.spawn(owner, components);

      mock.world.projection.adopt(entity);

      return entity;
    });

    slowViews(mock);
    // One top is made aside; two wait.
    frame(mock);
    show(windows, [SETTINGS]);
    frame(mock);

    expect(onStage(mock, settings)).toBe(true);
    expect(tops.map(top => placeOf(mock, top))).toEqual(["off", "off", "none"]);

    mock.world.projection.setLayers(COMING);
    mock.world.projection.commit();
    frame(mock);

    expect(tops.map(top => placeOf(mock, top))).toEqual(["stage", "stage", "stage"]);
  });

  // Bug: a window opened while a scene builds attaches the coming scene's tops with it: the next scene shows before
  // its commit.
  it("attaches only the window world shows while a scene builds, the build's tops at its commit", async () => {
    const windows = await warmWindows();
    const { mock } = windows;
    const settings = heldOf(mock, SETTINGS);

    expect(mock.world.projection.build([SETTINGS], owner, COMING, 4)).toBe(true);

    const top = mock.world.ecs.spawn(owner, boardTop(1));

    mock.world.projection.adopt(top);
    frame(mock);

    show(windows, [SETTINGS]);
    frame(mock);

    expect(onStage(mock, settings)).toBe(true);
    expect(onStage(mock, top)).toBe(false);
    expect(heldList(mock)).toEqual([top]);

    mock.world.projection.setLayers(COMING);
    mock.world.projection.commit();
    frame(mock);

    expect(onStage(mock, top)).toBe(true);
    expect(heldList(mock)).toEqual([]);
  });
});
