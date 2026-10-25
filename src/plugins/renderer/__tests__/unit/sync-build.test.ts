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
// Unit test of the next scene built aside (spec 31, F61 S2) in the renderer's
// sync: the views of the building entities are sorted out of the pass, made
// in chunks under `world.projection.left()`, parents first, held out of the
// stage, and attached in one block in the pass after the commit. The live
// scene stays drawn and hit, its walks are not taken again, and a discard
// attaches nothing.
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const owner = { kind: "plugin", name: "test" } as const;

/** The layers of the scene on screen. */
const WARD: readonly LayerSpec[] = [{ name: "items", sort: "none" }];

/** The layers of the coming scene: the ward's, and a board sorted by order that the ward does not declare. */
const BOARD: readonly LayerSpec[] = [
  { name: "items", sort: "none" },
  { name: "board", sort: "order" }
];

/** What a view of the tests draws: a 64 x 64 texture. */
const texture = new FakeTexture({});

/**
 * Starts a mock renderer showing the ward.
 *
 * @param layers - The layers on screen.
 * @returns The started mock.
 */
async function started(layers: readonly LayerSpec[] = WARD): Promise<MockRenderer> {
  const mock = createMockRenderer();

  await mock.start();
  mock.api.sync.textures.provide(() => texture as never);
  mock.world.projection.setLayers(layers);
  mock.modules.sync.pass();
  mock.world.clearChanges();

  return mock;
}

/**
 * Starts a build of the board with no projection of its own: the test spawns its entities and flags them, as `ui` does
 * with `adopt`.
 *
 * @param mock - The mock renderer.
 * @param budgetMs - The building budget of a frame.
 */
function startBuild(mock: MockRenderer, budgetMs = 4): void {
  expect(mock.world.projection.build([], owner, BOARD, budgetMs)).toBe(true);
}

/**
 * Spawns an entity of the build with all its components in one call, then flags it: `onAdded` fires before the flag,
 * as for a view world spawns.
 *
 * @param mock - The mock renderer.
 * @param components - Its components.
 * @returns The entity.
 */
function spawnBuilding(mock: MockRenderer, components: readonly AnyComponentValue[]): Entity {
  const entity = mock.world.ecs.spawn(owner, components);

  mock.world.projection.adopt(entity);

  return entity;
}

/**
 * A sprite top of the board at an order.
 *
 * @param order - Its `Order`.
 * @param x - Where it sits.
 * @returns Its components.
 */
function boardTop(order: number, x = 0): AnyComponentValue[] {
  return [
    Layer({ name: "board" }),
    Transform({ x }),
    Sprite({ texture: "board.cell" }),
    Order({ value: order })
  ];
}

/**
 * A sprite child of a parent at an order.
 *
 * @param parent - The parent entity.
 * @param order - Its `Order`.
 * @returns Its components.
 */
function childOf(parent: Entity, order = 0): AnyComponentValue[] {
  return [
    Transform(),
    Sprite({ texture: "board.cell" }),
    Parent({ entity: parent }),
    Order({ value: order })
  ];
}

/**
 * One frame: the world frame starts, the sync pass, the change sets closed, the render phase.
 *
 * @param mock - The mock renderer.
 */
function frame(mock: MockRenderer): void {
  mock.runPhase("input");
  mock.world.startFrame();
  mock.modules.sync.pass();
  mock.world.clearChanges();
  mock.runPhase("render");
}

/**
 * The swap as `scenes` makes it: the coming layers, then the commit; the next frame attaches.
 *
 * @param mock - The mock renderer.
 */
function commit(mock: MockRenderer): void {
  mock.world.projection.setLayers(BOARD);
  mock.world.projection.commit();
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
 * The top a view hangs by: its wrapper, else its object.
 *
 * @param mock - The mock renderer.
 * @param entity - The entity.
 * @returns The node a container holds.
 */
function topOf(mock: MockRenderer, entity: Entity): PixiContainer {
  const object = objectOf(mock, entity);

  return object.parent?.label === `parent#${entity}` ? object.parent : object;
}

/**
 * Tells whether a node hangs under the stage.
 *
 * @param mock - The mock renderer.
 * @param node - The node.
 * @returns True when the stage is one of its ancestors.
 */
function onStage(mock: MockRenderer, node: PixiContainer): boolean {
  const stage = mock.pixi.last().stage as unknown as PixiContainer;

  for (let parent = node.parent; parent !== null; parent = parent.parent) {
    if (parent === stage) return true;
  }

  return false;
}

/** A tree as the comparison reads it: labels, depths and children. */
type Shape = { label: string; zIndex: number; children: Shape[] };

/**
 * The shape of a subtree.
 *
 * @param node - Its root.
 * @returns Labels, depths and children, in order.
 */
function shapeOf(node: PixiContainer): Shape {
  return {
    label: node.label,
    zIndex: node.zIndex,
    children: node.children.map(child => shapeOf(child))
  };
}

/**
 * Makes every view creation spend more of the world clock than a frame's budget: the provider moves it on 5 ms.
 *
 * @param mock - The mock renderer.
 */
function slowViews(mock: MockRenderer): void {
  let now = 0;

  mock.api.sync.textures.provide(() => {
    now += 5;
    mock.setWorldNow(now);

    return texture as never;
  });
}

describe("a scene built aside: the views of the build", () => {
  // Bug: the renderer builds the views world spawns for the build in the live pass, straight into the layer: the board
  // is drawn over the ward before the swap. World flags them after `onAdded` fired, so the pass must sort them out.
  it("a view world spawns with all its components during a build hangs in no layer container", async () => {
    const mock = await started(BOARD);
    const items = projection({
      name: "board.items",
      layer: "board",
      from: () => [
        { id: "a", x: 10 },
        { id: "b", x: 20 }
      ],
      key: (item: { id: string; x: number }) => item.id,
      view: (item: { id: string; x: number }) => [
        Transform({ x: item.x }),
        Sprite({ texture: "board.cell" })
      ]
    }) as unknown as AnyProjectionSpec;

    mock.world.projection.register(items);
    expect(mock.world.projection.build(["board.items"], owner, BOARD, 4)).toBe(true);

    const built = [...mock.world.ecs.query(Layer)].map(([entity]) => entity);

    expect(built).toHaveLength(2);
    frame(mock);

    for (const entity of built) {
      expect(mock.world.projection.isBuilding(entity)).toBe(true);
      expect(objectOf(mock, entity).parent).toBeNull();
    }

    expect(mock.modules.sync.layerContainer("board")?.children).toHaveLength(0);
  });

  // Bug: the held tops hang in their layer in another order, or at the depth of the layer list of the old scene: the
  // swap draws the board shuffled, or the first frame after it differs from a switch in one block.
  it("holds a building view out of the stage until the commit, then hangs it as a one-block build does", async () => {
    const aside = await started();

    startBuild(aside);

    const second = spawnBuilding(aside, boardTop(2, 40));
    const first = spawnBuilding(aside, boardTop(1, 20));
    const child = spawnBuilding(aside, childOf(second));

    frame(aside);
    frame(aside);

    for (const entity of [second, first, child])
      expect(onStage(aside, topOf(aside, entity))).toBe(false);
    expect(aside.modules.sync.layerContainer("board")).toBeUndefined();

    commit(aside);
    frame(aside);

    const block = await started(BOARD);

    block.world.ecs.spawn(owner, boardTop(2, 40));
    block.world.ecs.spawn(owner, boardTop(1, 20));
    block.world.ecs.spawn(owner, childOf(second));
    frame(block);

    const asideRoot = aside.modules.sync.root();
    const blockRoot = block.modules.sync.root();

    if (asideRoot === undefined || blockRoot === undefined) throw new Error("no root");

    expect(shapeOf(asideRoot)).toEqual(shapeOf(blockRoot));
    expect(objectOf(aside, child).parent).toBe(topOf(aside, second));
  });

  // Bug: a building view whose parent is live (a kept projection, a slot host) is hung under it at once: the coming
  // scene shows inside the old one, and the live parent gets a wrapper it draws with before the swap.
  it("does not hang a building view under a live parent before the commit", async () => {
    const mock = await started();
    const host = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform(),
      Sprite({ texture: "ward.host" })
    ]);

    frame(mock);
    startBuild(mock);

    const guest = spawnBuilding(mock, childOf(host));

    frame(mock);

    expect(objectOf(mock, guest).parent).toBeNull();
    // No wrapper on the live host: it still hangs in its layer as it did.
    expect(objectOf(mock, host).parent).toBe(mock.modules.sync.layerContainer("items"));

    commit(mock);
    frame(mock);

    expect(objectOf(mock, guest).parent).toBe(topOf(mock, host));
    expect(onStage(mock, objectOf(mock, guest))).toBe(true);
  });
});

describe("a scene built aside: chunks under the budget", () => {
  // Bug: the build makes every view in the first frame (the jank the change exists for), or reads no clock and never
  // stops; a frame over budget must still make one, or the build never ends.
  it("makes one view a frame when each view spends more than the budget", async () => {
    const mock = await started();

    startBuild(mock);

    spawnBuilding(mock, boardTop(1));
    spawnBuilding(mock, boardTop(2));
    spawnBuilding(mock, boardTop(3));
    slowViews(mock);

    const made: number[] = [];

    for (let index = 0; index < 4; index += 1) {
      frame(mock);
      made.push(mock.modules.sync.counts().views);
    }

    expect(made).toEqual([1, 2, 3, 3]);
  });

  // Bug (U2.3): a child made in a later chunk than its parent finds no parent view, or a child queued before its
  // parent is made first: it is detached for good and never drawn after the swap.
  it("a child in a later chunk hangs under its parent, and a parent queued after its child is made first", async () => {
    const mock = await started();

    startBuild(mock);

    const parent = spawnBuilding(mock, boardTop(1));

    spawnBuilding(mock, boardTop(2));

    const late = spawnBuilding(mock, childOf(parent));
    const early = spawnBuilding(mock, childOf(0));
    const lateParent = spawnBuilding(mock, boardTop(3));

    mock.world.ecs.set(early, Parent, { entity: lateParent });
    slowViews(mock);

    for (let index = 0; index < 6; index += 1) frame(mock);

    expect(objectOf(mock, late).parent).toBe(topOf(mock, parent));
    expect(objectOf(mock, early).parent).toBe(topOf(mock, lateParent));
    expect(mock.ctx.state.sync.orphans.size).toBe(0);

    commit(mock);
    frame(mock);

    expect(onStage(mock, objectOf(mock, late))).toBe(true);
    expect(onStage(mock, objectOf(mock, early))).toBe(true);
  });

  // Bug: a frame whose only work is the aside queue runs the live pass and moves `passesVersion`: every build frame
  // walks the live scene's unseen loops and render passes again (the spike's finding).
  it("keeps the frame still and passesVersion where it was while only aside work waits", async () => {
    const mock = await started();
    const live = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform(),
      Sprite({ texture: "ward.bed" })
    ]);

    frame(mock);
    startBuild(mock);

    const parent = spawnBuilding(mock, boardTop(1));

    spawnBuilding(mock, childOf(parent));
    spawnBuilding(mock, boardTop(2));
    slowViews(mock);
    // The frame that sorts the build out of `added` is a working one: its spawn changed components.
    frame(mock);

    const version = mock.ctx.state.sync.passesVersion;
    const views = mock.modules.sync.counts().views;

    frame(mock);

    expect(mock.modules.sync.counts().views).toBeGreaterThan(views);
    expect(mock.ctx.state.sync.passesVersion).toBe(version);
    expect(objectOf(mock, live).parent).toBe(mock.modules.sync.layerContainer("items"));
  });
});

describe("a scene built aside: the end of the build", () => {
  // Bug: a discarded build attaches its held views anyway, or leaks them: the aborted scene shows over the old one.
  it("a discard destroys the held views and attaches none, also of views that never were made", async () => {
    const mock = await started();

    mock.world.ecs.spawn(owner, [Layer({ name: "items" }), Transform(), Sprite({ texture: "a" })]);
    frame(mock);

    const before = mock.modules.sync.counts();

    startBuild(mock);

    const top = spawnBuilding(mock, [
      Layer({ name: "items" }),
      Transform(),
      Sprite({ texture: "a" })
    ]);

    spawnBuilding(mock, childOf(top));
    spawnBuilding(mock, boardTop(1));
    spawnBuilding(mock, boardTop(2));
    slowViews(mock);
    frame(mock);
    frame(mock);

    const held = topOf(mock, top);

    mock.world.projection.discard();
    frame(mock);
    frame(mock);

    expect(mock.modules.sync.counts().views).toBe(before.views);
    expect(mock.modules.sync.counts().pooled).toBeGreaterThan(before.pooled);
    expect(mock.modules.sync.layerContainer("items")?.children).toHaveLength(1);
    expect(held.parent).toBeNull();
    expect(mock.ctx.state.sync.heldViews.count).toBe(0);
  });

  // Bug: a view still waiting aside when the build commits is never made: the commit cleared its flag, the queue
  // drops it, and a piece of the new scene is missing.
  it("a view still aside at the commit is made by the live pass after it and hangs in its layer", async () => {
    const mock = await started();

    startBuild(mock);
    spawnBuilding(mock, boardTop(1));

    const late = spawnBuilding(mock, boardTop(2));

    slowViews(mock);
    frame(mock);
    commit(mock);
    frame(mock);
    frame(mock);

    expect(onStage(mock, objectOf(mock, late))).toBe(true);
    expect(mock.modules.sync.layerContainer("board")?.children).toHaveLength(2);
  });

  // Bug: a device restore during a build rebuilds the building views straight into the stage, or lists a held top a
  // second time, which the swap then hangs twice.
  it("a rebuild during a build holds every building view again and the swap hangs each once", async () => {
    const mock = await started();

    startBuild(mock);
    spawnBuilding(mock, boardTop(1));
    spawnBuilding(mock, boardTop(2));
    frame(mock);
    mock.modules.sync.rebuildAll();
    frame(mock);

    expect(mock.ctx.state.sync.heldViews.count).toBe(2);
    expect(mock.modules.sync.layerContainer("board")).toBeUndefined();

    commit(mock);
    frame(mock);

    expect(mock.modules.sync.layerContainer("board")?.children).toHaveLength(2);
  });

  // Bug: the readiness answers true while views wait (the swap builds them all in one frame) or before the pass
  // sorted them out of `added` (the commit comes before any view exists), or holds the swap back once all are made.
  it("answers built() only when every building view is made", async () => {
    const mock = await started();
    const projection = mock.world.projection;

    startBuild(mock);
    spawnBuilding(mock, boardTop(1));
    spawnBuilding(mock, boardTop(2));

    // Spawned, not yet sorted by a pass.
    expect(projection.built()).toBe(false);

    slowViews(mock);
    mock.world.startFrame();
    mock.modules.sync.pass();
    // One made, one waits aside.
    expect(projection.built()).toBe(false);

    mock.world.clearChanges();
    mock.runPhase("render");
    mock.world.startFrame();
    mock.modules.sync.pass();
    // Both made: the renderer holds the swap back no longer.
    expect(projection.built()).toBe(true);

    // A live view the old scene spawns meanwhile holds nothing back.
    mock.world.ecs.spawn(owner, [Layer({ name: "items" }), Transform(), Sprite({ texture: "fx" })]);
    expect(projection.built()).toBe(true);
  });

  // Bug: a device lost during a build holds the switch back until a device comes back: nothing can be drawn, and the
  // rebuild of a restore makes every view anyway.
  it("answers built() while the device is lost", async () => {
    const mock = await started();

    startBuild(mock);
    spawnBuilding(mock, boardTop(1));
    slowViews(mock);
    frame(mock);
    spawnBuilding(mock, boardTop(2));

    expect(mock.world.projection.built()).toBe(false);

    mock.modules.sync.forget();

    expect(mock.world.projection.built()).toBe(true);
  });

  // Bug: a view of the build whose making throws (a texture provider, an adapter) stops the chunk, or keeps the queue
  // waiting: the swap never comes.
  it("reports a building view whose making throws and makes the rest of the build", async () => {
    const mock = await started();
    const broken = new Error("bad page");

    mock.api.sync.textures.provide(key => {
      if (key === "board.broken") throw broken;

      return texture as never;
    });
    startBuild(mock);

    const bad = spawnBuilding(mock, [
      Layer({ name: "board" }),
      Transform(),
      Sprite({ texture: "board.broken" })
    ]);
    const good = spawnBuilding(mock, boardTop(1));

    frame(mock);

    expect(mock.log.error).toHaveBeenCalledWith(
      "renderer: sync failed for an entity",
      expect.objectContaining({ entity: bad, error: broken })
    );
    expect(mock.api.sync.displayOf(good)).toBeDefined();
    expect(mock.world.projection.built()).toBe(true);
  });
});

describe("a scene built aside: frames", () => {
  // Bug: a frame of building work is taken for a sample of the adaptive rate, which then drops for the load; or a
  // frame with no such work is told as probed and never counts.
  it("tells time that a frame was probed on frames with aside work only", async () => {
    const mock = await started();
    const probed = vi.mocked(mock.time.frameProbed);
    let now = 100;
    const calls: number[] = [];
    const step = (): void => {
      const before = probed.mock.calls.length;

      frame(mock);
      calls.push(probed.mock.calls.length - before);
    };

    mock.setWorldNow(now);
    step();
    startBuild(mock);
    spawnBuilding(mock, boardTop(1));
    spawnBuilding(mock, boardTop(2));
    spawnBuilding(mock, boardTop(3));
    mock.api.sync.textures.provide(() => {
      now += 5;
      mock.setWorldNow(now);

      return texture as never;
    });
    // Views made: 1, 2, 3; then nothing but the wait for the swap.
    for (let index = 0; index < 6; index += 1) step();

    expect(calls).toEqual([0, 1, 1, 1, 0, 0, 0]);
  });

  // Bug: the hit test finds the coming scene's views before the swap (a tap lands on the board under the ward), or the
  // old one's after it.
  it("hits the old scene's view over a building view until the commit, the new one after", async () => {
    const mock = await started();
    const old = mock.world.ecs.spawn(owner, [
      Layer({ name: "items" }),
      Transform({ x: 540, y: 300 }),
      Sprite({ texture: "ward.bed" })
    ]);

    frame(mock);
    startBuild(mock);

    const coming = spawnBuilding(mock, [
      Layer({ name: "items" }),
      Transform({ x: 540, y: 300 }),
      Sprite({ texture: "board.cell" })
    ]);

    frame(mock);
    frame(mock);

    expect(mock.api.sync.hitTest(540, 300, () => true)).toBe(old);

    commit(mock);
    frame(mock);

    expect(mock.api.sync.hitTest(540, 300, () => true)).toBe(coming);
  });

  // Bug: the dev tree check (U2.5) takes a held view that a build frame moved for one hung in the wrong place and logs
  // a false `renderer:tree-mismatch`; or the move hangs it in its new layer before the swap.
  it("keeps a held view held and unreported by the tree check when its layer changes during the build", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);

    const mock = await started();

    startBuild(mock);

    const top = spawnBuilding(mock, boardTop(1));

    frame(mock);
    mock.world.ecs.set(top, Layer, { name: "items" });
    frame(mock);

    expect(objectOf(mock, top).parent).toBeNull();
    expect(mock.log.error).not.toHaveBeenCalledWith("renderer:tree-mismatch", expect.anything());
  });

  // Bug: a bug that hangs a building view under the stage goes unseen: the player sees the next scene early and only a
  // phone video shows it.
  it("warns renderer:building-drawn in a dev build for a building view under the stage, and not in a normal build", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);

    const mock = await started();

    startBuild(mock);

    const top = spawnBuilding(mock, boardTop(1));
    const child = spawnBuilding(mock, childOf(top));

    frame(mock);
    frame(mock);

    expect(mock.log.warn).not.toHaveBeenCalledWith("renderer:building-drawn", expect.anything());

    mock.modules.sync.layerContainer("items")?.addChild(topOf(mock, top));
    frame(mock);

    expect(mock.log.warn).toHaveBeenCalledWith("renderer:building-drawn", {
      entities: [top, child]
    });
  });
});
