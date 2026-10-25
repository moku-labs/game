import * as pixi from "pixi.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Layer, Order } from "../../../world/ecs/define";
import type { AnyComponentValue, Entity, LayerSpec } from "../../../world/types";
import { Parent, Sprite, Transform } from "../../components";
import { PREDRAW_NODES } from "../../sync/predraw";
import type { Config, PixiContainer } from "../../types";
import { createMockRenderer, type MockRenderer } from "../mock-renderer";
import { type RenderCall, type StagePixi, stagePixi } from "../stage-pixi";

// ---------------------------------------------------------------------------
// Unit test of the pre-draw of a scene built aside (spec 31, F61 S2), on the
// real Pixi of `stagePixi`: once every building view is made, the held tops
// are rendered into a 4 x 4 target of the renderer's own, in pieces of at most
// `PREDRAW_NODES` nodes, before the swap draws them. A piece that throws ends
// the pre-draw; a failed warm-up skips it; the swap attaches everything.
// ---------------------------------------------------------------------------

const running: MockRenderer[] = [];

afterEach(() => {
  for (const mock of running.splice(0)) mock.stop();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const owner = { kind: "plugin", name: "test" } as const;

/** The layers on screen. */
const WARD: readonly LayerSpec[] = [{ name: "items", sort: "none" }];

/** The layers of the coming scene. */
const BOARD: readonly LayerSpec[] = [
  { name: "items", sort: "none" },
  { name: "board", sort: "order" }
];

/** A renderer over the real Pixi, and the renders of its last application. */
type Predrawn = {
  mock: MockRenderer;
  stage: StagePixi;
  /** The renders into the pre-draw's target, oldest first. */
  pieces(): RenderCall[];
  /** One frame: the world frame starts, the sync pass, the change sets closed, then input and render. */
  frame(): void;
};

/**
 * Starts the renderer over the real Pixi of `stagePixi`, showing the ward.
 *
 * @param config - Config of the renderer: `warm: 0` unless given.
 * @returns The running renderer.
 */
async function startStage(config: Partial<Config> = {}): Promise<Predrawn> {
  const stage = stagePixi();
  const mock = createMockRenderer({
    config: { warm: 0, ...config, loadPixi: () => Promise.resolve(stage.module) }
  });
  const texture = new pixi.Texture({ source: new pixi.TextureSource({ width: 64, height: 64 }) });

  running.push(mock);
  await mock.start();
  mock.api.sync.textures.provide(() => texture);
  mock.world.projection.setLayers(WARD);

  const frame = (): void => {
    mock.world.startFrame();
    mock.modules.sync.pass();
    mock.world.clearChanges();
    mock.runPhase("input");
    mock.runPhase("render");
  };

  frame();

  return {
    mock,
    stage,
    pieces: () => stage.targets().filter(call => call.target?.source.label === "renderer.predraw"),
    frame
  };
}

/**
 * Spawns an entity of the build, flagged right after its spawn as world and `ui` do.
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

/** A board top of the tests: the top, its three groups with their leaves, and every leaf. */
type BigTop = {
  top: Entity;
  groups: Array<{ entity: Entity; leaves: Entity[] }>;
  leaves: Entity[];
};

/**
 * Builds a board top of 98 nodes: the top and three groups under it, thirty leaves in each.
 *
 * @param mock - The mock renderer.
 * @param order - The top's `Order`.
 * @returns The top, its groups and every leaf.
 */
function bigTop(mock: MockRenderer, order: number): BigTop {
  const top = spawnBuilding(mock, [
    Layer({ name: "board" }),
    Transform(),
    Sprite({ texture: "board.back" }),
    Order({ value: order })
  ]);
  const leaves: Entity[] = [];
  const groups: BigTop["groups"] = [];

  for (let group = 0; group < 3; group += 1) {
    const parent = spawnBuilding(mock, [
      Transform({ x: group * 100 }),
      Sprite({ texture: "board.row" }),
      Parent({ entity: top }),
      Order({ value: group })
    ]);

    const own: Entity[] = [];

    for (let leaf = 0; leaf < 30; leaf += 1) {
      own.push(
        spawnBuilding(mock, [
          Transform({ y: leaf * 10 }),
          Sprite({ texture: "board.cell" }),
          Parent({ entity: parent }),
          Order({ value: leaf })
        ])
      );
    }

    groups.push({ entity: parent, leaves: own });
    leaves.push(...own);
  }

  return { top, groups, leaves };
}

/**
 * The nodes of a subtree.
 *
 * @param node - Its root.
 * @returns The node count.
 */
function nodesIn(node: pixi.Container): number {
  let count = 1;

  for (const child of node.children) count += nodesIn(child);

  return count;
}

/**
 * Tells whether a node hangs in a subtree.
 *
 * @param node - The node.
 * @param root - The root of the subtree.
 * @returns True when `root` is the node or one of its ancestors.
 */
function inside(node: PixiContainer, root: pixi.Container): boolean {
  for (let at: PixiContainer | null = node; at !== null; at = at.parent) {
    if (at === root) return true;
  }

  return false;
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
 * The swap as `scenes` makes it, and the frame that attaches.
 *
 * @param run - The running renderer.
 */
function swap(run: Predrawn): void {
  run.mock.world.projection.setLayers(BOARD);
  run.mock.world.projection.commit();
  run.frame();
}

describe("the pre-draw of a scene built aside", () => {
  // Bug: a held top is drawn whole in one call (a 15 ms frame on the A26), a piece is cut by level and still holds a
  // big subtree, a node is left out of every piece, or the render group Pixi made of a piece stays and changes how the
  // tree is drawn live.
  it("draws every held top into its own target in pieces of at most PREDRAW_NODES nodes", async () => {
    const run = await startStage();

    run.mock.world.projection.build([], owner, BOARD, 4);

    const { leaves } = bigTop(run.mock, 1);

    run.frame();
    run.frame();

    const pieces = run.pieces();

    expect(pieces.length).toBeGreaterThan(1);

    for (const call of pieces) {
      expect(nodesIn(call.container)).toBeLessThanOrEqual(PREDRAW_NODES);
      expect(call.container.isRenderGroup).toBe(false);
    }

    for (const leaf of leaves) {
      expect(pieces.some(call => inside(objectOf(run.mock, leaf), call.container))).toBe(true);
    }

    expect(run.mock.world.projection.built()).toBe(true);
  });

  // Bug: a piece cut from a view that left during the build is rendered anyway: a destroyed object throws and ends the
  // pre-draw, a pooled one the live scene took back is rendered and made a render group.
  it("cuts a held top again when a cut piece left it, and draws no piece outside its top", async () => {
    const run = await startStage();
    const wrong: string[] = [];
    let now = 0;

    run.mock.world.projection.build([], owner, BOARD, 4);

    const big = bigTop(run.mock, 1);
    const topObject = (): pixi.Container | null => objectOf(run.mock, big.top).parent;

    run.stage.last().renderer.watchers.push(call => {
      if (call.target?.source.label !== "renderer.predraw") return;

      const top = topObject();

      if (call.container.destroyed || top === null || !inside(call.container, top)) {
        wrong.push(call.container.label);
      }

      // Every piece spends more than the frame's budget: one piece a frame.
      now += 5;
      run.mock.setWorldNow(now);
    });
    run.frame();

    const gone = big.groups[1];
    const last = big.groups[2];

    if (gone === undefined || last === undefined) throw new Error("no groups");

    const lastTop = objectOf(run.mock, last.entity).parent;

    for (const leaf of gone.leaves) run.mock.world.ecs.despawn(leaf);
    run.mock.world.ecs.despawn(gone.entity);

    for (let index = 0; index < 5; index += 1) run.frame();

    expect(wrong).toEqual([]);
    expect(run.pieces().some(call => call.container === lastTop)).toBe(true);
    expect(run.mock.world.projection.built()).toBe(true);
  });

  // Bug: the rest of a held top that left during the pre-draw is still drawn: its objects are in the pool (or destroyed)
  // by then, so the pre-draw renders what the live scene may take back, or throws on a destroyed one.
  it("passes over the rest of a held top that left during the pre-draw and draws the next one", async () => {
    const run = await startStage();
    let now = 0;

    run.stage.last().renderer.watchers.push(call => {
      if (call.target?.source.label !== "renderer.predraw") return;

      now += 5;
      run.mock.setWorldNow(now);
    });
    run.mock.world.projection.build([], owner, BOARD, 4);

    const first = bigTop(run.mock, 1);

    bigTop(run.mock, 2);
    run.frame();

    const firstTop = objectOf(run.mock, first.top).parent;
    const left = new Set<pixi.Container>();
    const collect = (node: pixi.Container): void => {
      left.add(node);
      for (const child of node.children) collect(child);
    };

    if (firstTop === null) throw new Error("no wrapper");

    collect(firstTop);

    const before = run.pieces().length;

    for (const entity of [...first.leaves, ...first.groups.map(group => group.entity), first.top]) {
      run.mock.world.ecs.despawn(entity);
    }

    for (let index = 0; index < 6; index += 1) run.frame();

    const after = run.pieces().slice(before);

    expect(after.filter(call => left.has(call.container))).toEqual([]);
    expect(after).toHaveLength(4);
    expect(run.mock.world.projection.built()).toBe(true);
  });

  // Bug: a piece that throws inside Pixi is drawn again every frame, or holds the swap back for good: the switch never
  // happens. The swap must draw as without the pre-draw.
  it("ends the pre-draw at a piece that throws, logs it once, and the swap still attaches every held top", async () => {
    const run = await startStage();
    const thrown = new Error("no pipeline");
    let calls = 0;

    run.stage.last().renderer.watchers.push(call => {
      if (call.target?.source.label !== "renderer.predraw") return;

      calls += 1;
      if (calls === 2) throw thrown;
    });
    run.mock.world.projection.build([], owner, BOARD, 4);

    const first = bigTop(run.mock, 1).top;
    const second = bigTop(run.mock, 2).top;

    run.frame();
    run.frame();
    run.frame();

    expect(calls).toBe(2);
    expect(run.mock.log.error).toHaveBeenCalledWith("renderer:predraw-failed", { error: thrown });
    expect(run.mock.world.projection.built()).toBe(true);

    swap(run);

    const board = run.mock.modules.sync.layerContainer("board");

    expect(objectOf(run.mock, first).parent?.parent).toBe(board);
    expect(objectOf(run.mock, second).parent?.parent).toBe(board);
  });

  // Bug: the pre-draw borrows the warm-up's target, which exists only after a warm frame with `warm` above 0: with the
  // warm-up off nothing is pre-drawn.
  it("pre-draws on its own target with the warm-up off", async () => {
    const run = await startStage({ warm: 0 });

    run.mock.world.projection.build([], owner, BOARD, 4);
    spawnBuilding(run.mock, [Layer({ name: "board" }), Transform(), Sprite({ texture: "a" })]);
    run.frame();

    expect(run.pieces()).toHaveLength(1);
    expect(run.mock.ctx.state.sync.warm.objects).toBeUndefined();
  });

  // Bug: after a warm-up probe threw (Pixi's filter stack left unbalanced) the pre-draw renders anyway and throws in
  // every piece, or waits for a pre-draw that never comes and the swap never happens.
  it("skips the pre-draw after a failed warm-up, and the swap attaches everything", async () => {
    const run = await startStage({ warm: 1 });

    run.stage.last().renderer.watchers.push(call => {
      if (call.container.label === "renderer.warm") throw new Error("no pipeline");
    });
    run.frame();

    expect(run.mock.ctx.state.sync.warm.failed).toBe(true);

    run.mock.world.projection.build([], owner, BOARD, 4);

    const top = spawnBuilding(run.mock, [
      Layer({ name: "board" }),
      Transform(),
      Sprite({ texture: "a" })
    ]);

    run.frame();

    expect(run.pieces()).toHaveLength(0);
    expect(run.mock.world.projection.built()).toBe(true);

    swap(run);

    expect(objectOf(run.mock, top).parent).toBe(run.mock.modules.sync.layerContainer("board"));
  });
});
