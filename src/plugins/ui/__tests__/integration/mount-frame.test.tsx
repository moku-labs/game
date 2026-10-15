import * as pixiJs from "pixi.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  component,
  createApp,
  createPlugin,
  defineFeature,
  defineGame,
  defineScene,
  Layer,
  Order,
  Parent,
  projection,
  Shape,
  screen,
  system,
  Tappable,
  Touchable,
  Transform,
  type,
  worldPlugin
} from "../../../../index";
import type { Manifest } from "../../../assets/types";
import { Held, Pressed } from "../../../input/components";
import { installFakeDom } from "../../../renderer/__tests__/fake-dom";
import { type FrameOracle, watchFrames } from "../../../renderer/__tests__/stage-oracle";
import { type StagePixi, stagePixi } from "../../../renderer/__tests__/stage-pixi";
import { Tree } from "../../../world/ecs/define";
import type { DescriptionNode } from "../../../world/projection/types";
import type { Entity, Api as WorldApi } from "../../../world/types";
import type * as HostsModule from "../../jsx/hosts";
import {
  afterEachFrame,
  type DrawnApp,
  type DrawnPixi,
  type DrawnPlayer,
  type DrawnPoint,
  drag,
  pointer,
  pointOf,
  press,
  settle,
  startDrawnApp,
  step,
  tick
} from "../drawn-app";

// ---------------------------------------------------------------------------
// Spec 16 U2 (F14, K4): the views a slot hosts hang under it in the first frame they are drawn,
// and they take presses and drags right away, after a re-entry, a restore and a popup. The app
// draws on the real Pixi with a stand-in GPU, on demand, and the tree oracle reads every frame
// (K5): a frame skipped while the screen changed fails the test. The tests that would have caught
// ae4049a, and the port of A Memory Missing's "a hosted view spawned before its root" (D1).
// ---------------------------------------------------------------------------

/** Every call of the hosting step, in order: `"all"` for the full step, the walked hosts for the solve's. */
const hostCalls = vi.hoisted(() => [] as Array<"all" | number[]>);

vi.mock("../../jsx/hosts", async importOriginal => {
  const actual = await importOriginal<typeof HostsModule>();

  return {
    ...actual,
    hostViews: vi.fn((...args: Parameters<typeof HostsModule.hostViews>) => {
      const only = args[2];

      hostCalls.push(only === undefined ? "all" : [...only]);
      actual.hostViews(...args);
    })
  };
});

/** The apps a test started, with the oracle that watched them; stopped after the oracle's last word. */
const running: Array<{ stop(): Promise<void>; oracle: FrameOracle }> = [];

afterEach(async () => {
  for (const { stop, oracle } of running.splice(0)) {
    oracle.expectNoMissedFrame();
    await stop();
  }

  hostCalls.length = 0;
  vi.unstubAllGlobals();
});

/** A real 64 x 64 texture with no pixels, the one every key answers. */
function blankTexture(): pixiJs.Texture {
  return new pixiJs.Texture({ source: new pixiJs.TextureSource({ width: 64, height: 64 }) });
}

/**
 * Starts the drawn app on the real Pixi, drawn on demand, at the ward, with the tree oracle
 * checking every frame the helpers step from here on.
 *
 * @returns The app, its Pixi and the oracle.
 */
async function startWatched() {
  const stage = stagePixi();
  const texture = blankTexture();
  const drawn = await startDrawnApp({ stage, texture: () => texture });
  const oracle = watchFrames(stage.last(), pixiJs);

  afterEachFrame(drawn.app, () => oracle.check());
  running.push({ stop: () => drawn.app.stop(), oracle });

  return { ...drawn, oracle };
}

/**
 * The entity of a keyed element, failing the test when it is not mounted.
 *
 * @param app - The running app.
 * @param key - The key of the element.
 * @returns The entity.
 */
function entityOf(app: DrawnApp, key: string): number {
  // eslint-disable-next-line unicorn/no-array-callback-reference -- `ui.find` takes a key, not a callback.
  const entity = app.ui.find(key);

  expect(entity).toBeDefined();

  return entity ?? 0;
}

/** What the tests read of a display object. */
type Shown = { label: string; parent: Shown | null };

/**
 * The label of the container a view hangs in.
 *
 * @param app - The running app.
 * @param entity - The entity of the view.
 * @returns The label, or `undefined` while the view hangs nowhere.
 */
function hostLabelOf(app: DrawnApp, entity: Entity): string | undefined {
  return (app.renderer.sync.displayOf(entity) as Shown | undefined)?.parent?.label;
}

/** The label `sync` gives the container the viewport is written on: the top of every drawn view. */
const ROOT_LABEL = "renderer.root";

/**
 * Whether a view is drawn: its display object has a path up to the root of `sync`.
 *
 * @param app - The running app.
 * @param entity - The entity of the view.
 * @returns True when it is on the stage.
 */
function isDrawn(app: DrawnApp, entity: Entity): boolean {
  let node = app.renderer.sync.displayOf(entity) as Shown | null | undefined;

  while (node !== null && node !== undefined) {
    if (node.label === ROOT_LABEL) return true;
    node = node.parent;
  }

  return false;
}

/** The world views the board's field hosts: the cells and the items. */
function hostedViews(app: DrawnApp): Entity[] {
  return [
    ...app.world.projection.entitiesOf("board.cells"),
    ...app.world.projection.entitiesOf("board.items")
  ];
}

/**
 * Answers `board` at the ward and steps frame by frame until every hosted view of the board is
 * drawn, noting where each hangs in the first frame it is drawn.
 *
 * @param app - The running app, at the ward.
 * @returns The container label of each view in its first drawn frame, by entity.
 */
async function enterBoard(app: DrawnApp): Promise<Map<Entity, string | undefined>> {
  const firsts = new Map<Entity, string | undefined>();

  app.flow.gate.answer({ intent: "board" });

  const fieldOf = (): number | undefined => app.ui.find("field");

  for (let frame = 0; frame < 40 && (firsts.size < 3 || fieldOf() === undefined); frame += 1) {
    await tick();
    step(app);

    for (const entity of hostedViews(app)) {
      if (!firsts.has(entity) && isDrawn(app, entity)) firsts.set(entity, hostLabelOf(app, entity));
    }
  }

  await tick();

  return firsts;
}

/**
 * The one item and the two cells of the board.
 *
 * @param app - The running app, at the board.
 * @returns The entities.
 */
function boardViews(app: DrawnApp): { item: Entity; c1: Entity; c2: Entity } {
  const { projection } = app.world;

  return {
    item: projection.entityOf("board.items", "i1") ?? 0,
    c1: projection.entityOf("board.cells", "c1") ?? 0,
    c2: projection.entityOf("board.cells", "c2") ?? 0
  };
}

/**
 * The point a view is drawn at, failing the test when it is not drawn.
 *
 * @param app - The running app.
 * @param entity - The drawn entity.
 * @returns The centre of its hit box.
 */
function centreOf(app: DrawnApp, entity: Entity): DrawnPoint {
  const point = pointOf(app, entity);

  expect(point).toBeDefined();

  return point ?? { x: 0, y: 0 };
}

/**
 * The cell the model holds the one item on.
 *
 * @param app - The running app.
 * @returns The cell id.
 */
function cellOfItem(app: DrawnApp): string | undefined {
  const player = app.model.store.snapshot().player as DrawnPlayer;

  return player.items[0]?.cell;
}

/**
 * Drags the item onto the second cell and lets the board take the drop.
 *
 * @param app - The running app, at the board.
 * @param pixi - Its Pixi.
 * @returns The cell the model then holds the item on.
 */
async function dropOnSecondCell(app: DrawnApp, pixi: DrawnPixi): Promise<string | undefined> {
  const { item, c2 } = boardViews(app);

  await drag(app, pixi, centreOf(app, item), centreOf(app, c2));
  await settle(app, 4);

  return cellOfItem(app);
}

describe("the views a slot hosts, in the frame the slot comes (F14, K4)", () => {
  // Bug: hosted one frame late, every item and cell is drawn for one frame on its own, in its
  // layer, over the scene that leaves.
  it("hangs every hosted item and cell under the field in the first frame it is drawn", async () => {
    const { app } = await startWatched();
    const firsts = await enterBoard(app);
    const field = entityOf(app, "field");

    expect([...firsts.values()]).toEqual([`parent#${field}`, `parent#${field}`, `parent#${field}`]);
  });

  // Bug (ae4049a on the phone): after a mount-frame hosting the board took no press at all.
  it("presses an item in the frame after it is first drawn", async () => {
    const { app, pixi } = await startWatched();
    const pressed: Entity[] = [];

    await enterBoard(app);
    app.world.ecs.onAdded(Pressed, entity => pressed.push(entity));

    const { item } = boardViews(app);

    await press(app, pixi, centreOf(app, item));

    expect(pressed).toEqual([item]);
  });

  it("drags an item onto a cell after the board mounts, and the node takes the drop", async () => {
    const { app, pixi } = await startWatched();

    await enterBoard(app);

    expect(await dropOnSecondCell(app, pixi)).toBe("c2");
    expect(app.flow.state().path).toBe("board");
  });

  // Bug H2: the hit test maps the point through the ECS but finds its candidates in the Pixi tree.
  it("hits every hosted view where it is drawn", async () => {
    const { app } = await startWatched();

    await enterBoard(app);

    const views = hostedViews(app);
    const hits = views.map(entity => {
      const at = centreOf(app, entity);

      return app.renderer.sync.hitTest(at.x, at.y, candidate => candidate === entity);
    });

    expect(hits).toEqual(views);
  });

  it("drags after the board comes back from the ward", async () => {
    const { app, pixi } = await startWatched();

    await enterBoard(app);
    app.flow.gate.answer({ intent: "back" });
    await settle(app, 2);

    expect(app.flow.state().path).toBe("ward");

    const firsts = await enterBoard(app);
    const field = entityOf(app, "field");

    expect([...firsts.values()].every(label => label === `parent#${field}`)).toBe(true);
    expect(await dropOnSecondCell(app, pixi)).toBe("c2");
  });

  // Bug (H3): after a restore the new slot comes while the old parent's removal is still queued,
  // so the views are drawn alone in their layer for a frame.
  it("keeps the views in their slot through a restore at the board, and drags after it", async () => {
    const { app, pixi } = await startWatched();

    await enterBoard(app);

    const bookmark = app.flow.bookmark();

    expect(await dropOnSecondCell(app, pixi)).toBe("c2");

    const restored = app.flow.restore(bookmark);
    const labels = new Set<string | undefined>();

    for (let frame = 0; frame < 6; frame += 1) {
      await tick();
      step(app);

      for (const entity of hostedViews(app)) {
        if (isDrawn(app, entity)) labels.add(hostLabelOf(app, entity));
      }
    }

    await restored;
    await app.flow.walk([]);
    await settle(app, 2);

    const field = entityOf(app, "field");

    expect([...labels].every(label => label?.startsWith("parent#") === true)).toBe(true);
    expect(hostedViews(app).map(entity => hostLabelOf(app, entity))).toEqual([
      `parent#${field}`,
      `parent#${field}`,
      `parent#${field}`
    ]);
    expect(cellOfItem(app)).toBe("c1");
    expect(await dropOnSecondCell(app, pixi)).toBe("c2");
  });

  it("drags after the shop popup opens over the board and closes", async () => {
    const { app, pixi } = await startWatched();

    await enterBoard(app);
    app.flow.gate.answer({ intent: "shop" });
    await settle(app, 3);
    await press(app, pixi, centreOf(app, entityOf(app, "shopClose")));
    await settle(app, 3);

    expect(app.ui.find("shopClose")).toBeUndefined();
    expect(app.flow.state().path).toBe("board");
    expect(await dropOnSecondCell(app, pixi)).toBe("c2");
  });

  // Bug: the solve's hosting gives the held view its parent back in the middle of the drag.
  it("keeps a drag in progress through a solve of another root, and the drop lands", async () => {
    const { app, pixi } = await startWatched();

    await enterBoard(app);

    const { item, c2 } = boardViews(app);
    const from = centreOf(app, item);
    const to = centreOf(app, c2);
    const half = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
    const node = (<column key="lateRoot" style={{ width: 100, height: 100 }} />) as DescriptionNode;

    pointer(app, pixi, "pointerdown", from);
    step(app);
    pointer(app, pixi, "pointermove", half);
    step(app);
    app.world.ecs.spawn({ kind: "plugin", name: "test" }, [Tree({ node })]);
    step(app);
    step(app);

    expect(app.ui.find("lateRoot")).toBeDefined();
    expect({
      held: app.world.ecs.has(item, Held),
      parent: app.world.ecs.get(item, Parent)
    }).toEqual({ held: true, parent: undefined });

    pointer(app, pixi, "pointermove", to);
    step(app);
    pointer(app, pixi, "pointerup", to);
    step(app);
    await settle(app, 4);

    expect(cellOfItem(app)).toBe("c2");
  });

  // Bug H4: a hosted view inserted into the host's wrapper before the host's own child is covered
  // by it at equal depth, so a child that takes the press over its whole box swallows every press.
  it("draws and hits a hosted view over a child of its host at zIndex 0", async () => {
    const { app } = await startWatched();
    const pan = app.world.projection.entityOf("ward.pan", "pan") ?? 0;
    const frame = entityOf(app, "panFrame");
    const at = centreOf(app, pan);

    expect(app.renderer.sync.hitTest(at.x, at.y, hit => hit === pan || hit === frame)).toBe(pan);
  });

  // Bug H3: a second full hosting step in one phase reads parents before the first one's land.
  it("hosts once per frame: the solve step walks only the hosts that came in it", async () => {
    const { app } = await startWatched();
    const frames: Array<Array<"all" | number[]>> = [];

    app.flow.gate.answer({ intent: "board" });

    for (let frame = 0; frame < 20; frame += 1) {
      hostCalls.length = 0;
      await tick();
      step(app);
      frames.push([...hostCalls]);
    }

    const field = entityOf(app, "field");

    expect(frames.filter(calls => calls.length > 1)).toEqual([["all", [field]]]);
    expect(frames.every(calls => calls[0] === "all")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// D1 (LEAD-FIXES-4 item 9): A Memory Missing's `plugins/panorama/__tests__/integration/
// hosting.test.ts`, the second describe (`hostsFirst`), ported. A game plugin hosts the views of
// a projection under a world-view root, the way the game's camera hosts its hot zones under its
// `Pan` root; the scene lists the hosted views before their root, so they are spawned, and built
// by the renderer, before their parent.
// ---------------------------------------------------------------------------

/** The root the plugin adopts, as the game's camera adopts its `Pan` root. */
const Room = component("hosting.room", { w: 0 });

/** The owner of the touch surface the plugin spawns. */
const ROOM_OWNER = { kind: "plugin", name: "roomHost" } as const;

/** The projection whose views the root hosts. */
const ZONES = "hosting.zones";

/** The adopted root and its touch surface. */
const adopted = { root: 0, surface: 0 };

/**
 * Hosts the free zones under the adopted root, and spawns its touch surface once the root has
 * its layer, as the game's camera does in its `apply` step.
 *
 * @param world - The world of the app.
 */
function hostRoom(world: WorldApi): void {
  const { ecs, projection: views } = world;

  if (adopted.root === 0) return;

  const layer = ecs.get(adopted.root, Layer);

  if (adopted.surface === 0 && layer !== undefined) {
    adopted.surface = ecs.spawn(ROOM_OWNER, [
      Parent({ entity: adopted.root }),
      Transform({ x: 0, y: 0 }),
      Shape({ kind: "rect", w: 1080, h: 1080, fill: 0xff_ff_ff, fillAlpha: 0 }),
      Order({ value: 100_000 }),
      Touchable(),
      Layer({ name: layer.name })
    ]);
  }

  for (const view of views.entitiesOf(ZONES)) {
    if (!ecs.has(view, Parent)) ecs.add(view, Parent({ entity: adopted.root }));
  }
}

/** The game plugin of the port: adopts a `Room` root in its `onAdded`, mid-spawn, and hosts the zones. */
const roomHostPlugin = createPlugin("roomHost", {
  depends: [worldPlugin],
  onStart: ctx => {
    const world = ctx.require(worldPlugin);
    const { ecs } = world;

    ecs.onAdded(Room, root => {
      adopted.root = root;
      adopted.surface = 0;
      hostRoom(world);
    });
    ecs.onRemoved(Room, () => {
      if (adopted.surface !== 0) ecs.despawn(adopted.surface);
      adopted.root = 0;
      adopted.surface = 0;
    });
    ecs.system(
      system({ name: "roomHost.layout", phase: "layout", query: [], run: () => hostRoom(world) })
    );
    ecs.system(
      system({
        name: "roomHost.sync",
        phase: "sync",
        query: [],
        run: () => {
          if (ecs.mode() !== "live") hostRoom(world);
        }
      })
    );
  }
});

const hosting = defineGame<{
  player: { n: number };
  session: Record<string, never>;
  assets: string;
  strings: Record<string, never>;
}>();

/** The root: a world view with a picture, hosting the zones. */
const room = projection({
  name: "hosting.room",
  layer: "scene",
  from: () => ({ id: "room" }),
  view: () => [Room({ w: 1080 }), Shape({ kind: "rect", w: 1080, h: 1080, fill: 0x9f_b7_b4 })]
});

/** The one hot zone, drawn inside the root. */
const zones = projection({
  name: ZONES,
  layer: "scene",
  from: () => [{ id: "folder", x: 600, y: 600 }],
  key: (zone: { id: string }) => zone.id,
  view: (zone: { id: string; x: number; y: number }) => [
    Transform({ x: zone.x, y: zone.y }),
    Shape({ kind: "rect", w: 96, h: 54, fill: 0xff_9b_83 }),
    Tappable({ intent: "zone", payload: { id: zone.id } }),
    Order({ value: 1 })
  ]
});

/** The scene lists the hosted views first, as the ward lists its pan root after them. */
const wide = defineScene("wide", {
  bundle: "hosting",
  layers: { scene: { sort: "order" } },
  projections: [zones, room]
});
const other = defineScene("other", { bundle: "hosting", layers: {}, projections: [] });

const hub = hosting.defineNode({
  scene: "wide",
  rest: true,
  outcomes: { leave: type(), zone: type() }
});
const away = hosting.defineNode({ scene: "other", rest: true, outcomes: { back: type() } });
const hostingFlow = hosting.defineFlow("main", {
  nodes: { hub, away },
  start: "hub",
  outcomes: {},
  edges: { hub: { leave: "away", zone: "hub" }, away: { back: "hub" } }
});
const hostingFeature = defineFeature("hosting", {
  flows: [hostingFlow],
  scenes: [wide, other],
  projections: [room, zones]
});

/** The bundle the scenes name, with no file in it. */
const hostingManifest: Manifest = {
  version: 2,
  bundles: { hosting: { feature: "hosting", tier: "lazy", mb: 0, files: [] } }
};

/** One way the wide scene comes on screen. */
type Way = "start" | "entry" | "restore" | "device";

/**
 * Waits until the graph rests at a node with its gate open.
 *
 * @param app - The app.
 * @param app.flow - Its flow.
 * @param path - The path of the rest node.
 */
async function arrive(app: { flow: DrawnApp["flow"] }, path: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    if (app.flow.state().path === path && app.flow.gate.state().open) return;
    await new Promise(resolve => setTimeout(resolve, 0));
  }

  throw new Error(`The flow did not rest at "${path}".`);
}

/**
 * Starts the port's game on the real Pixi at `hub`, before its first frame.
 *
 * @returns The app and the stand-in Pixi it draws on.
 */
async function openHosting() {
  adopted.root = 0;
  adopted.surface = 0;
  installFakeDom({ width: 1080, height: 1920 });

  const stage = stagePixi();
  const texture = blankTexture();
  const app = createApp({
    plugins: [...screen, hostingFeature, roomHostPlugin],
    pluginConfigs: {
      assets: { manifest: hostingManifest },
      flow: { mainFlow: hostingFlow },
      log: { mode: "test" },
      model: { initialPlayer: { n: 0 }, initialSession: {}, seed: 1 },
      renderer: {
        mount: "#game",
        loadPixi: () => Promise.resolve(stage.module),
        onDemand: true,
        warm: 0
      }
    }
  });

  await app.start();
  app.renderer.sync.textures.provide(() => texture as never);
  app.flow.run().catch(() => undefined);
  await arrive(app, "hub");

  return { app, stage };
}

/** The app of the port. */
type HostingApp = Awaited<ReturnType<typeof openHosting>>["app"];

/**
 * Brings the wide scene on screen once more, one way, and stops before its first frame.
 *
 * @param app - The app, resting at `hub` with its first frames drawn.
 * @param stage - The stand-in Pixi it draws on.
 * @param way - The first start, a node entry from the other scene, a restore from there, or a
 *   rebuild after a lost GPU device.
 */
async function bringBack(app: HostingApp, stage: StagePixi, way: Way): Promise<void> {
  if (way === "start") return;

  if (way === "device") {
    const before = stage.applications.length;

    stage.last().renderer.loseDevice?.();

    for (let turn = 0; turn < 50 && stage.applications.length === before; turn += 1) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }

    await tick();

    return;
  }

  const bookmark = app.flow.bookmark();

  app.flow.gate.answer({ intent: "leave" });
  await arrive(app, "away");
  app.time.step(16);

  if (way === "entry") {
    app.flow.gate.answer({ intent: "back" });
    await arrive(app, "hub");

    return;
  }

  await app.flow.restore(bookmark);
  await app.flow.walk([]);
}

describe("a hosted view spawned before its root (D1, A Memory Missing hostsFirst)", () => {
  // Bug: the view is built before its parent and left out of the tree, for good or for the first
  // frame, so a hot zone flashes out of the room or is never drawn and never hit.
  it.each<Way>([
    "start",
    "entry",
    "restore",
    "device"
  ])("is drawn inside the root in the first frame, with the touch surface (%s)", async way => {
    const { app, stage } = await openHosting();

    if (way !== "start") app.time.step(16);
    await bringBack(app, stage, way);

    const oracle = watchFrames(stage.last(), pixiJs);

    running.push({ stop: () => app.stop(), oracle });

    const before = stage.renders();

    app.time.step(16);
    oracle.check();

    const zone = app.world.projection.entityOf(ZONES, "folder") ?? 0;
    const hangsIn = (entity: Entity): string | undefined =>
      (app.renderer.sync.displayOf(entity) as Shown | undefined)?.parent?.label;
    const orphaned = app.log
      .trace()
      .filter(entry => entry.event === "renderer: parent draws nothing").length;

    expect({
      drawn: stage.renders() - before,
      zone: hangsIn(zone),
      surface: hangsIn(adopted.surface),
      orphaned
    }).toEqual({
      drawn: 1,
      zone: `parent#${adopted.root}`,
      surface: `parent#${adopted.root}`,
      orphaned: 0
    });
  });
});
