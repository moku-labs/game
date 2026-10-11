import { describe, expect, it } from "vitest";
import {
  animPlugin,
  createApp,
  defineAnimation,
  defineGame,
  defineMotion,
  exit,
  play,
  projection,
  rendererPlugin,
  Transform,
  tween,
  type,
  worldPlugin
} from "../../../../index";
import type { Target } from "../../../anim/types";

// ---------------------------------------------------------------------------
// Integration: the rest pose of a view that loops, in the very fields its loop
// adds to. The loop of `anim` keeps its own base for those fields. So a rest
// value the world writes directly has to reach that base, in play mode and
// after the flush of a direct reconcile. And a view something moved in such a
// field has to come home: the driver reports what the loop adds, so the world
// sees the value under it. The real time, lifecycle, model, clock, flow,
// world, renderer and anim plugins.
// ---------------------------------------------------------------------------

type Piece = { id: string; x: number; y: number; rot: number };
type Player = { pieces: Piece[] };
type Session = { shifts: number };

const { defineNode, defineFlow, defineFeature } = defineGame<{
  player: Player;
  session: Session;
  assets: string;
  strings: Record<string, unknown>;
}>();

/** One cycle of the loop, in milliseconds. */
const LOOP_MS = 400;

/** How far the loop lifts the view half way through a cycle, in reference units. */
const BOB_REACH = 10;

/** How far the loop turns the view half way through a cycle, in radians. */
const SWAY_REACH = 0.1;

/** A bob and a sway in one loop: it adds to `y` and to `rotation`. */
const float = defineMotion({
  keyframes: {
    float: [
      { at: 0, Transform: { dy: 0, rotation: 0 } },
      { at: 0.5, ease: "linear", Transform: { dy: BOB_REACH, rotation: SWAY_REACH } },
      { at: 1, ease: "linear", Transform: { dy: 0, rotation: 0 } }
    ]
  },
  transition: { ms: LOOP_MS },
  loop: { track: "float" },
  on: {}
});

/** The pieces have no `change` hook: a changed component is written directly. */
const boardPieces = projection({
  name: "board.pieces",
  layer: "pieces",
  from: (player: Player) => player.pieces,
  key: (found: Piece) => found.id,
  view: (found: Piece) => [Transform({ x: found.x, y: found.y, rotation: found.rot, scale: 1 })],
  motion: float
});

const piece: Target = { projection: "board.pieces", key: "p1" };

/** The launch: the piece flies up and off the screen, in the field its loop bobs in. */
const fly = defineAnimation("board.fly", {
  slots: { piece: type<Target>() },
  build: ({ piece: target }) => tween(target, Transform, { y: -900 }, { ms: 400, ease: "linear" })
});

const home = defineNode({
  rest: true,
  checkpoint: true,
  outcomes: { shift: type(), go: type(), wait: type(), quit: type() }
});

/** A node that commits nothing: a walk over it writes no model root. */
const idle = defineNode({
  outcomes: { done: type() },
  run: ({ out }) => out.done()
});

const launch = defineNode({
  outcomes: { done: type() },
  run: async ({ fx }) => {
    await fx(play(fly, { piece }));

    throw new Error("the launch broke");
  }
});

const shift = defineNode({
  outcomes: { done: type() },
  run: ({ player, session, out }) => {
    for (const found of player.pieces) {
      found.x = 500;
      found.y = 700;
      found.rot = 1;
    }

    session.shifts += 1;

    return out.done();
  }
});

const main = defineFlow("main", {
  nodes: { home, shift, launch, idle },
  start: "home",
  outcomes: { over: type() },
  edges: {
    home: { shift: "shift", go: "launch", wait: "idle", quit: exit("over") },
    shift: { done: "home" },
    launch: { done: "home" },
    idle: { done: "home" }
  }
});

const boardFeature = defineFeature("board", {
  flows: [main],
  projections: [boardPieces],
  animations: [fly]
});

/** Yields the microtask queue to the flow loop, the way a test waits without a timer. */
const tick = async (times = 40): Promise<void> => {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
};

/**
 * The share of its reach the loop adds after it ran for some time: a straight walk out and back.
 *
 * @param elapsed - Milliseconds the loop has run.
 * @returns A number from 0 to 1.
 * @example
 * ```ts
 * reachAt(100); // 0.5
 * reachAt(416); // 0.08
 * ```
 */
function reachAt(elapsed: number): number {
  const phase = elapsed % LOOP_MS;
  const half = LOOP_MS / 2;

  return (phase <= half ? phase : LOOP_MS - phase) / half;
}

/**
 * Starts an app that rests at `home` with one piece whose loop runs.
 *
 * @returns The app and the entity of the piece.
 */
async function startBoard() {
  const app = createApp({
    plugins: [worldPlugin, rendererPlugin, animPlugin, boardFeature],
    pluginConfigs: {
      flow: { mainFlow: main, safeNode: "home" },
      model: {
        initialPlayer: { pieces: [{ id: "p1", x: 100, y: 300, rot: 0 }] },
        initialSession: { shifts: 0 },
        seed: 1
      }
    }
  });

  await app.start();
  app.flow.run().catch(() => undefined);
  await tick();

  app.world.projection.setLayers([{ name: "pieces", sort: "none" }]);
  app.world.projection.mount(["board.pieces"], { kind: "plugin", name: "test" });
  // The piece was mounted directly: this frame starts its loop, every later one moves it.
  app.time.step(16);

  expect(app.flow.state().path).toBe("home");
  expect(app.anim.active()).toBe(1);

  return { app, entity: app.world.projection.entityOf("board.pieces", "p1") ?? 0 };
}

type Board = Awaited<ReturnType<typeof startBoard>>;

/**
 * Checks the pose of the piece on its new rest pose, with what the loop adds after `elapsed`.
 *
 * @param board - The started board.
 * @param elapsed - Milliseconds the running loop has run.
 */
function expectShifted(board: Board, elapsed: number): void {
  const pose = board.app.world.ecs.get(board.entity, Transform);

  expect(pose).toMatchObject({ x: 500, scale: 1 });
  expect(pose?.y).toBeCloseTo(700 + BOB_REACH * reachAt(elapsed), 6);
  expect(pose?.rotation).toBeCloseTo(1 + SWAY_REACH * reachAt(elapsed), 6);
}

describe("world — a commit moves the rest pose under the loop of a view", () => {
  it("keeps the new rest pose in play mode, in the fields the loop adds to", async () => {
    const board = await startBoard();
    const { app, entity } = board;

    app.time.step(100);

    expect(app.world.ecs.get(entity, Transform)?.y).toBeCloseTo(305, 6);

    expect(app.flow.gate.answer({ intent: "shift" })).toBe(true);
    await tick();
    app.time.step(16);

    expect(app.world.projection.restOf(entity, Transform)).toMatchObject({
      x: 500,
      y: 700,
      rotation: 1
    });
    // The loop ran on over the change: 116 ms of its cycle, on the new rest pose.
    expectShifted(board, 116);

    app.time.step(16);
    app.time.step(400);

    expectShifted(board, 532);
    expect(app.anim.active()).toBe(1);
    expect(app.log.trace().filter(entry => entry.event === "world:view-corrected")).toEqual([]);

    await app.stop();
  });

  it("keeps the new rest pose after a commit in a paused world, and the loop starts on it", async () => {
    const board = await startBoard();
    const { app, entity } = board;

    app.time.step(100);
    app.world.ecs.setMode("paused");

    expect(app.flow.gate.answer({ intent: "shift" })).toBe(true);
    await tick();
    app.time.step(16);

    // The flush ended the loop, which wrote its old base back. The rest pose is written last.
    expect(app.world.ecs.get(entity, Transform)).toMatchObject({
      x: 500,
      y: 700,
      rotation: 1,
      scale: 1
    });
    expect(app.anim.active()).toBe(0);

    app.world.ecs.setMode("live");
    // The first live frame starts the owed loop, the second one moves it.
    app.time.step(16);
    app.time.step(100);

    expectShifted(board, 100);
    expect(app.anim.active()).toBe(1);

    await app.stop();
  });

  it("keeps the new rest pose after a fast walk over the commit, and the loop starts on it", async () => {
    const board = await startBoard();
    const { app, entity } = board;

    app.time.step(100);

    await app.flow.walk([{ at: "home", intent: "shift" }]);

    expect(app.flow.state().mode).toBe("live");
    expect(app.world.ecs.get(entity, Transform)).toMatchObject({
      x: 500,
      y: 700,
      rotation: 1,
      scale: 1
    });

    app.time.step(16);
    app.time.step(100);

    expectShifted(board, 100);
    expect(app.anim.active()).toBe(1);

    await app.stop();
  });
});

/**
 * Checks the pose of the piece on its first rest pose, with what the loop adds after `elapsed`.
 *
 * @param board - The started board.
 * @param elapsed - Milliseconds the loop has run.
 */
function expectHome(board: Board, elapsed: number): void {
  const pose = board.app.world.ecs.get(board.entity, Transform);

  expect(pose).toMatchObject({ x: 100, scale: 1 });
  expect(pose?.y).toBeCloseTo(300 + BOB_REACH * reachAt(elapsed), 6);
  expect(pose?.rotation).toBeCloseTo(SWAY_REACH * reachAt(elapsed), 6);
}

describe("world — the loop of a view outlasts a fast walk that commits nothing", () => {
  it("still runs after a walk with frames inside: no reconcile had to start it again", async () => {
    const board = await startBoard();
    const { app, entity } = board;

    app.time.step(100);

    // The walk is fast and its node writes no model root, so nothing flushes the view.
    const walked = app.flow.walk([{ at: "home", intent: "wait" }]);

    app.time.step(16);
    await tick();
    app.time.step(16);
    await walked;

    expect(app.flow.state()).toMatchObject({ path: "home", mode: "live" });
    expect(app.anim.active()).toBe(1);

    const before = app.world.ecs.get(entity, Transform)?.y ?? 0;

    app.time.step(16);
    app.time.step(16);

    // The loop moves the view again, around its rest pose.
    expect(app.anim.active()).toBe(1);
    expect(app.world.ecs.get(entity, Transform)?.y).not.toBe(before);
    expect(app.world.ecs.get(entity, Transform)?.y).toBeGreaterThanOrEqual(300);
    expect(app.world.ecs.get(entity, Transform)?.y).toBeLessThanOrEqual(300 + BOB_REACH);

    await app.stop();
  });
});

describe("world — a view moved in the field its loop adds to comes home", () => {
  it("a rollback settles a bobbing view a failed node flew up, and the loop runs on", async () => {
    const board = await startBoard();
    const { app, entity } = board;

    app.time.step(100);

    expect(app.flow.gate.answer({ intent: "go" })).toBe(true);
    await tick();
    app.time.step(16);
    app.time.step(400);
    await tick();

    expect(app.flow.state().path).toBe("home");
    // The node awaited its timeline: the piece is off the screen, and only its loop runs.
    expect(app.world.ecs.get(entity, Transform)?.y).toBeLessThan(-800);
    expect(app.anim.active()).toBe(1);

    app.time.step(16);

    // The settle of the rollback, next to the loop.
    expect(app.anim.active()).toBe(2);

    app.time.step(350);

    expectHome(board, 882);
    expect(app.anim.active()).toBe(1);
    expect(app.log.trace().filter(entry => entry.event === "world:view-corrected")).toEqual([]);

    await app.stop();
  });

  it("settle(entity) brings a bobbing view home after a drop straight above its place, without a jump", async () => {
    const board = await startBoard();
    const { app, entity } = board;

    app.time.step(100);

    // The hand owns the place of the piece while it drags, and moves it straight up.
    const release = app.world.projection.mute(entity, Transform, ["x", "y"]);

    app.world.ecs.set(entity, Transform, { y: 50 });
    app.time.step(16);

    expect(app.world.ecs.get(entity, Transform)?.y).toBe(50);

    release();
    app.world.projection.settle(entity);

    expect(app.anim.active()).toBe(2);

    app.time.step(16);

    // The first frame after the drop: a short way home from where the hand let go, no jump.
    expect(app.world.ecs.get(entity, Transform)?.y).toBeGreaterThan(50);
    expect(app.world.ecs.get(entity, Transform)?.y).toBeLessThan(100);

    app.time.step(350);

    expectHome(board, 482);
    expect(app.anim.active()).toBe(1);

    await app.stop();
  });

  it("settle(entity) brings a bobbing view home after a drop somewhere else, in both fields at one pace", async () => {
    const board = await startBoard();
    const { app, entity } = board;

    app.time.step(100);

    const release = app.world.projection.mute(entity, Transform, ["x", "y"]);

    app.world.ecs.set(entity, Transform, { x: 400, y: 50 });
    app.time.step(16);
    release();
    app.world.projection.settle(entity);
    app.time.step(16);

    const first = app.world.ecs.get(entity, Transform);

    // Both fields are the same short way home: `y` did not jump ahead of `x`.
    expect(first?.x).toBeGreaterThan(350);
    expect(first?.x).toBeLessThan(400);
    expect(first?.y).toBeGreaterThan(50);
    expect(first?.y).toBeLessThan(100);

    app.time.step(350);

    expectHome(board, 482);
    expect(app.anim.active()).toBe(1);

    await app.stop();
  });
});
