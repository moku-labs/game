import { describe, expect, it } from "vitest";
import {
  animPlugin,
  createApp,
  defineAnimation,
  defineGame,
  defineMotion,
  exit,
  Layer,
  play,
  projection,
  rendererPlugin,
  Transform,
  tween,
  type,
  worldPlugin
} from "../../../../index";
import type { Target } from "../../../anim/types";
import { component } from "../../ecs/define";

// ---------------------------------------------------------------------------
// Integration: the world compares the value under the loop of a view with its
// rest pose. The tween driver of `anim` reports what its additive tracks add
// right now, and the world takes that off the stored value. So a looping view
// that stands at home is home: no settle starts, no settle hook is called and
// no track runs for it. A view something moved is not, in whatever field, and
// the convergence check corrects a real miss and never the offset. The real
// time, lifecycle, model, clock, flow, world, renderer and anim plugins.
// ---------------------------------------------------------------------------

type Piece = { id: string; x: number; y: number; rot: number; level: number };
type Player = { pieces: Piece[]; dials: Piece[] };
type Session = { launches: number };

const { defineNode, defineFlow, defineFeature } = defineGame<{
  player: Player;
  session: Session;
  assets: string;
  strings: Record<string, unknown>;
}>();

const Level = component("Level", { level: 1 });

/** One cycle of the loop, in milliseconds. */
const LOOP_MS = 400;

/** How far the loop lifts a view half way through a cycle, in reference units. */
const BOB_REACH = 10;

/** How far the loop turns a view half way through a cycle, in radians. */
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

/** Every call of the settle hook of the pieces, with the components it was given. */
const settled: string[][] = [];

const boardPieces = projection({
  name: "board.pieces",
  layer: "pieces",
  lift: "lifted",
  from: (player: Player) => player.pieces,
  key: (found: Piece) => found.id,
  view: (found: Piece) => [
    Level({ level: found.level }),
    Transform({ x: found.x, y: found.y, rotation: found.rot, scale: 1 })
  ],
  motion: {
    ...float,
    // An exit that moves nothing: the piece stands on its rest pose while it leaves.
    exit: view => view.tween(Transform, { scale: 1 }, { ms: 400, ease: "linear" }),
    settle: (view, components) => {
      settled.push([...components]);

      return view.all(
        components.map(name => (name === "Level" ? view.toRest(Level) : view.toRest(Transform)))
      );
    }
  }
});

/** A dial whose change hook stops half way: it leaves the dial off its new rest pose. */
const boardDials = projection({
  name: "board.dials",
  layer: "pieces",
  from: (player: Player) => player.dials,
  key: (found: Piece) => found.id,
  view: (found: Piece) => [
    Level({ level: found.level }),
    Transform({ x: found.x, y: found.y, rotation: found.rot, scale: 1 })
  ],
  motion: {
    ...float,
    change: {
      Transform: view => view.tween(Transform, { rotation: 0.5 }, { ms: 48, ease: "linear" })
    }
  }
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
  outcomes: {
    go: type(),
    soar: type(),
    trip: type(),
    grow: type(),
    hide: type(),
    show: type(),
    turn: type(),
    tune: type(),
    quit: type()
  }
});

/** A launch that works: the node awaits its timeline and commits nothing. */
const soar = defineNode({
  outcomes: { done: type() },
  run: async ({ fx, out }) => {
    await fx(play(fly, { piece }));

    return out.done();
  }
});

const tune = defineNode({
  outcomes: { done: type() },
  run: ({ player, out }) => {
    for (const found of player.dials) found.level += 1;

    return out.done();
  }
});

const launch = defineNode({
  outcomes: { done: type() },
  run: async ({ fx }) => {
    await fx(play(fly, { piece }));

    throw new Error("the launch broke");
  }
});

const stumble = defineNode({
  outcomes: { done: type() },
  run: () => {
    throw new Error("the node broke before it moved anything");
  }
});

const grow = defineNode({
  outcomes: { done: type() },
  run: ({ player, out }) => {
    for (const found of player.pieces) found.level += 1;

    return out.done();
  }
});

const hide = defineNode({
  outcomes: { done: type() },
  run: ({ player, out }) => {
    player.pieces = [];

    return out.done();
  }
});

const show = defineNode({
  outcomes: { done: type() },
  run: ({ player, out }) => {
    player.pieces = [{ id: "p1", x: 100, y: 300, rot: 0, level: 1 }];

    return out.done();
  }
});

const turn = defineNode({
  outcomes: { done: type() },
  run: ({ player, out }) => {
    for (const found of player.dials) found.rot = 1;

    return out.done();
  }
});

const main = defineFlow("main", {
  nodes: { home, launch, soar, stumble, grow, hide, show, turn, tune },
  start: "home",
  outcomes: { over: type() },
  edges: {
    home: {
      go: "launch",
      soar: "soar",
      trip: "stumble",
      grow: "grow",
      hide: "hide",
      show: "show",
      turn: "turn",
      tune: "tune",
      quit: exit("over")
    },
    launch: { done: "home" },
    soar: { done: "home" },
    tune: { done: "home" },
    stumble: { done: "home" },
    grow: { done: "home" },
    hide: { done: "home" },
    show: { done: "home" },
    turn: { done: "home" }
  }
});

const boardFeature = defineFeature("board", {
  flows: [main],
  components: [Level],
  projections: [boardPieces, boardDials],
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
 * Starts an app that rests at `home` with one piece and one dial whose loops run, and counts the
 * time those loops have run.
 *
 * @returns The app, both entities, a `step` that counts and the time the loops ran.
 */
async function startBoard() {
  settled.length = 0;

  const app = createApp({
    plugins: [worldPlugin, rendererPlugin, animPlugin, boardFeature],
    pluginConfigs: {
      flow: { mainFlow: main, safeNode: "home" },
      model: {
        initialPlayer: {
          pieces: [{ id: "p1", x: 100, y: 300, rot: 0, level: 1 }],
          dials: [{ id: "d1", x: 600, y: 300, rot: 0, level: 1 }]
        },
        initialSession: { launches: 0 },
        seed: 1
      }
    }
  });

  await app.start();
  app.flow.run().catch(() => undefined);
  await tick();

  app.world.projection.setLayers([
    { name: "pieces", sort: "none" },
    { name: "lifted", sort: "none" }
  ]);
  app.world.projection.mount(["board.pieces", "board.dials"], { kind: "plugin", name: "test" });
  // Both views were mounted directly: this frame starts their loops, every later one moves them.
  app.time.step(16);

  expect(app.flow.state().path).toBe("home");
  // The loop of the piece and the loop of the dial: what runs while nothing else does.
  expect(app.anim.active()).toBe(2);

  const clock = { looped: 0 };

  return {
    app,
    piece: app.world.projection.entityOf("board.pieces", "p1") ?? 0,
    dial: app.world.projection.entityOf("board.dials", "d1") ?? 0,
    step: (ms: number): void => {
      app.time.step(ms);
      clock.looped += ms;
    },
    looped: (): number => clock.looped
  };
}

type Board = Awaited<ReturnType<typeof startBoard>>;

/**
 * Counts the `world:view-corrected` entries of the log trace.
 *
 * @param board - The started board.
 * @returns How many views the convergence check corrected.
 */
function corrected(board: Board): number {
  return board.app.log.trace().filter(entry => entry.event === "world:view-corrected").length;
}

/**
 * Checks that the piece stands on its rest pose, with what its loop adds right now.
 *
 * @param board - The started board.
 */
function expectPieceHome(board: Board): void {
  const pose = board.app.world.ecs.get(board.piece, Transform);
  const reach = reachAt(board.looped());

  expect(pose).toMatchObject({ x: 100, scale: 1 });
  expect(pose?.y).toBeCloseTo(300 + BOB_REACH * reach, 6);
  expect(pose?.rotation).toBeCloseTo(SWAY_REACH * reach, 6);
}

/**
 * Steps frames of 16 ms until a condition holds, with an upper bound so a bug cannot hang.
 *
 * @param board - The started board.
 * @param done - The condition to wait for.
 * @param max - Largest number of frames to step.
 */
function stepUntil(board: Board, done: () => boolean, max = 12): void {
  for (let frame = 0; frame < max && !done(); frame += 1) board.step(16);
}

describe("world — a looping view that stands at home is home", () => {
  it("guard against a settle of no length: a rollback starts no settle for it and calls no settle hook", async () => {
    const board = await startBoard();
    const { app } = board;

    board.step(100);

    expect(app.flow.gate.answer({ intent: "trip" })).toBe(true);
    await tick();
    board.step(16);

    expect(app.flow.state().path).toBe("home");
    expect(settled).toEqual([]);
    expect(app.anim.active()).toBe(2);
    expectPieceHome(board);

    board.step(100);

    expectPieceHome(board);
    expect(app.anim.active()).toBe(2);
    expect(corrected(board)).toBe(0);

    await app.stop();
  });

  it("guard against a settle of no length: settle(entity) starts no settle for it", async () => {
    const board = await startBoard();
    const { app } = board;

    board.step(100);
    app.world.projection.settle(board.piece);

    expect(settled).toEqual([]);
    expect(app.anim.active()).toBe(2);

    board.step(16);

    expectPieceHome(board);
    expect(app.anim.active()).toBe(2);

    await app.stop();
  });

  it("guard against a settle of no length: a commit that changes another component of it starts no settle", async () => {
    const board = await startBoard();
    const { app } = board;

    board.step(100);

    expect(app.flow.gate.answer({ intent: "grow" })).toBe(true);
    await tick();
    board.step(16);

    // `Level` has no hook: it is written directly. Nothing else of the piece is touched.
    expect(app.world.ecs.get(board.piece, Level)).toEqual({ level: 2 });
    expect(settled).toEqual([]);
    expect(app.anim.active()).toBe(2);
    expectPieceHome(board);

    await app.stop();
  });

  it("guard against a settle of no length: a revive of it starts no settle", async () => {
    const board = await startBoard();
    const { app } = board;

    board.step(100);

    expect(app.flow.gate.answer({ intent: "hide" })).toBe(true);
    await tick();
    board.step(16);

    // The piece leaves: its exit plays next to both loops, and it is no live view meanwhile.
    expect(app.world.projection.entityOf("board.pieces", "p1")).toBeUndefined();
    expect(app.anim.active()).toBe(3);

    expect(app.flow.gate.answer({ intent: "show" })).toBe(true);
    await tick();
    board.step(16);

    // The key came back while the exit played: the same view, with nothing to bring home.
    expect(app.world.projection.entityOf("board.pieces", "p1")).toBe(board.piece);
    expect(settled).toEqual([]);
    expect(app.anim.active()).toBe(2);
    expectPieceHome(board);

    await app.stop();
  });
});

describe("world — a looping view the hand held", () => {
  it("stays home when the hand did not move it: no settle, and the value under the loop does not move", async () => {
    const board = await startBoard();
    const { app, piece } = board;

    board.step(100);

    // The hand owns the place of the piece over six frames and writes nothing.
    const release = app.world.projection.mute(piece, Transform, ["x", "y"]);

    for (let frame = 0; frame < 6; frame += 1) board.step(16);

    release();
    app.world.projection.settle(piece);

    expect(settled).toEqual([]);
    expect(app.anim.active()).toBe(2);

    board.step(16);

    expectPieceHome(board);

    for (let frame = 0; frame < 30; frame += 1) board.step(16);

    expectPieceHome(board);
    expect(corrected(board)).toBe(0);

    // The loops end: every view stands on the value under its loop, the rest pose.
    app.anim.finishAll();

    expect(app.world.ecs.get(piece, Transform)).toMatchObject({
      x: 100,
      y: 300,
      rotation: 0,
      scale: 1
    });

    await app.stop();
  });

  it("guard: a view the hand put back on its rest pose is settled home, the loop does not shift it", async () => {
    const board = await startBoard();
    const { app, piece } = board;

    board.step(100);

    const release = app.world.projection.mute(piece, Transform, ["x", "y"]);

    // The hand writes the rest place itself, without what the loop added when it took over.
    app.world.ecs.set(piece, Transform, { x: 100, y: 300 });
    board.step(16);
    release();
    app.world.projection.settle(piece);

    // The loop adds to where the hand left the piece, so the value under it is off: a settle.
    expect(settled).toEqual([["Transform"]]);

    for (let frame = 0; frame < 23; frame += 1) board.step(16);

    expectPieceHome(board);
    expect(app.anim.active()).toBe(2);

    await app.stop();
  });
});

describe("world — a rest value written under a loop reaches the driver at once", () => {
  it("keeps a correction of the convergence check when the next frame commits another component", async () => {
    const board = await startBoard();
    const { app, dial } = board;

    board.step(100);

    expect(app.flow.gate.answer({ intent: "turn" })).toBe(true);
    await tick();
    stepUntil(board, () => corrected(board) > 0);

    expect(corrected(board)).toBe(1);

    // The very next frame reconciles a commit of another component: it cancels the motions.
    expect(app.flow.gate.answer({ intent: "tune" })).toBe(true);
    await tick();
    board.step(16);

    expect(app.world.ecs.get(dial, Level)).toEqual({ level: 2 });
    expect(app.world.ecs.get(dial, Transform)?.rotation).toBeCloseTo(
      1 + SWAY_REACH * reachAt(board.looped()),
      6
    );

    for (let frame = 0; frame < 40; frame += 1) board.step(16);

    expect(app.world.ecs.get(dial, Transform)?.rotation).toBeCloseTo(
      1 + SWAY_REACH * reachAt(board.looped()),
      6
    );
    expect(corrected(board)).toBe(1);

    await app.stop();
  });

  it("brings a flown view home with settle(entity) in a paused world, drops it at once, and it stays home when the world is live", async () => {
    const board = await startBoard();
    const { app, piece } = board;

    board.step(100);

    expect(app.flow.gate.answer({ intent: "soar" })).toBe(true);
    await tick();
    board.step(16);
    board.step(400);
    await tick();
    board.step(16);

    expect(app.flow.state().path).toBe("home");
    // The node flew the piece up and committed nothing: it stays off the screen.
    expect(app.world.ecs.get(piece, Transform)?.y).toBeLessThan(-800);

    app.world.ecs.setMode("paused");
    app.world.projection.lift(piece, true);
    app.world.projection.settle(piece);
    app.world.projection.lift(piece, false);

    // The rest pose stands with what the loop adds, and nothing is left to wait for: the drop
    // takes effect at once.
    expectPieceHome(board);
    expect(app.world.ecs.get(piece, Layer)).toEqual({ name: "pieces" });

    // Two frames of the paused world move nothing.
    app.time.step(16);
    app.time.step(16);

    expectPieceHome(board);
    expect(app.world.ecs.get(piece, Layer)).toEqual({ name: "pieces" });

    app.world.ecs.setMode("live");

    expect(app.flow.gate.answer({ intent: "grow" })).toBe(true);
    await tick();
    board.step(16);

    // The first live frame reconciles a commit, which cancels the motions of the piece.
    expect(app.world.ecs.get(piece, Level)).toEqual({ level: 2 });
    expectPieceHome(board);

    for (let frame = 0; frame < 30; frame += 1) board.step(16);

    expectPieceHome(board);

    await app.stop();
  });
});

describe("world — a looping view something moved is brought home", () => {
  it("a rollback settles a bobbing view a failed node flew up, without a jump, and its loop runs on", async () => {
    const board = await startBoard();
    const { app } = board;

    board.step(100);

    expect(app.flow.gate.answer({ intent: "go" })).toBe(true);
    await tick();
    board.step(16);
    board.step(400);
    await tick();

    expect(app.flow.state().path).toBe("home");
    // The node awaited its timeline: the piece is off the screen, and only the two loops run.
    expect(app.world.ecs.get(board.piece, Transform)?.y).toBeLessThan(-800);
    expect(app.anim.active()).toBe(2);

    const heights: number[] = [];

    // The settle takes `settleMs`, 350 ms: 22 frames of 16 ms and one more to be past it.
    for (let frame = 0; frame < 23; frame += 1) {
      board.step(16);
      heights.push(app.world.ecs.get(board.piece, Transform)?.y ?? 0);
    }

    // Only the piece was settled, once: the dial stands at home and is left alone.
    expect(settled).toEqual([["Transform"]]);
    // The first frame is a short way home from where the node left the piece, not a jump.
    expect(heights[0]).toBeLessThan(-700);
    // No frame goes back, and no frame covers more than an eighth of the way.
    expect(heights.every((height, at) => height >= (heights[at - 1] ?? height) - BOB_REACH)).toBe(
      true
    );
    expect(heights.every((height, at) => height - (heights[at - 1] ?? height) < 150)).toBe(true);
    expectPieceHome(board);
    expect(app.anim.active()).toBe(2);
    expect(corrected(board)).toBe(0);

    await app.stop();
  });
});

describe("world — the convergence check reads the value under the loop", () => {
  it("corrects a real miss in a field the loop adds to, to the rest value plus the offset", async () => {
    const board = await startBoard();
    const { app, dial } = board;

    board.step(100);

    expect(app.flow.gate.answer({ intent: "turn" })).toBe(true);
    await tick();
    // The change hook of the dial stops at 0.5, half way to the new rest rotation of 1.
    stepUntil(board, () => corrected(board) > 0);

    expect(corrected(board)).toBe(1);
    // The frame of the correction shows the rest value with the offset on top: no lost sway.
    expect(app.world.ecs.get(dial, Transform)?.rotation).toBeCloseTo(
      1 + SWAY_REACH * reachAt(board.looped()),
      6
    );
    expect(app.world.ecs.get(dial, Transform)?.y).toBeCloseTo(
      300 + BOB_REACH * reachAt(board.looped()),
      6
    );

    board.step(16);
    board.step(100);

    // The loop runs on over the new rest value, and the check has nothing more to say.
    expect(app.world.ecs.get(dial, Transform)?.rotation).toBeCloseTo(
      1 + SWAY_REACH * reachAt(board.looped()),
      6
    );
    expect(corrected(board)).toBe(1);
    expect(app.anim.active()).toBe(2);

    await app.stop();
  });
});
