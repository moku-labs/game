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
import { component } from "../../ecs/define";

// ---------------------------------------------------------------------------
// Integration: a view that loops is brought home like any other. Its loop is an
// additive track: it adds an offset to the rest pose and owns no component. So
// the settle of a rollback, of `settle(entity)` and of a changed item moves a
// swaying view home, the sway runs on over it, and the end of a motion does not
// take the offset of the sway for a miss. The real time, lifecycle, model,
// clock, flow, world, renderer and anim plugins.
// ---------------------------------------------------------------------------

type Piece = { id: string; x: number; y: number; level: number };
type Player = { pieces: Piece[]; cards: Piece[] };
type Session = { launches: number };

const { defineNode, defineFlow, defineFeature } = defineGame<{
  player: Player;
  session: Session;
  assets: string;
  strings: Record<string, unknown>;
}>();

const Level = component("Level", { level: 1 });

const piece: Target = { projection: "board.pieces", key: "p1" };

/** The launch: the piece flies off the screen in 400 ms. */
const fly = defineAnimation("board.fly", {
  slots: { piece: type<Target>() },
  build: ({ piece: target }) => tween(target, Transform, { y: -900 }, { ms: 400, ease: "linear" })
});

/** One cycle of the sway, in milliseconds. */
const SWAY_MS = 400;

/** The rotation the sway reaches half way through a cycle. */
const SWAY_REACH = 0.1;

/** The three keys of the sway: out to one side and back. */
const SWAY_KEYS = [
  { at: 0, Transform: { rotation: 0 } },
  { at: 0.5, ease: "linear", Transform: { rotation: SWAY_REACH } },
  { at: 1, ease: "linear", Transform: { rotation: 0 } }
] as const;

/** A sway for as long as the view lives. */
const sway = defineMotion({
  keyframes: { sway: SWAY_KEYS },
  transition: { ms: SWAY_MS },
  loop: { track: "sway" },
  on: {}
});

/** The same sway next to a pop-in of 96 ms, as an order card plays both. */
const popAndSway = defineMotion({
  states: { small: { Transform: { scale: 0.8 } } },
  keyframes: { sway: SWAY_KEYS },
  transition: { ms: 96 },
  loop: { track: "sway", ms: SWAY_MS },
  on: { enter: "small" }
});

const boardPieces = projection({
  name: "board.pieces",
  layer: "pieces",
  from: (player: Player) => player.pieces,
  key: (found: Piece) => found.id,
  view: (found: Piece) => [
    Level({ level: found.level }),
    Transform({ x: found.x, y: found.y, rotation: 0, scale: 1 })
  ],
  motion: sway
});

const boardCards = projection({
  name: "board.cards",
  layer: "pieces",
  from: (player: Player) => player.cards,
  key: (found: Piece) => found.id,
  view: (found: Piece) => [Transform({ x: found.x, y: found.y, rotation: 0, scale: 1 })],
  motion: popAndSway
});

const home = defineNode({
  rest: true,
  checkpoint: true,
  outcomes: { go: type(), trip: type(), grow: type(), deal: type(), quit: type() }
});

const launch = defineNode({
  outcomes: { done: type() },
  run: async ({ session, fx }) => {
    session.launches += 1;
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

const deal = defineNode({
  outcomes: { done: type() },
  run: ({ player, out }) => {
    player.cards = [{ id: "c1", x: 500, y: 300, level: 1 }];

    return out.done();
  }
});

const main = defineFlow("main", {
  nodes: { home, launch, stumble, grow, deal },
  start: "home",
  outcomes: { over: type() },
  edges: {
    home: { go: "launch", trip: "stumble", grow: "grow", deal: "deal", quit: exit("over") },
    launch: { done: "home" },
    stumble: { done: "home" },
    grow: { done: "home" },
    deal: { done: "home" }
  }
});

const boardFeature = defineFeature("board", {
  flows: [main],
  components: [Level],
  projections: [boardPieces, boardCards],
  animations: [fly]
});

/** Yields the microtask queue to the flow loop, the way a test waits without a timer. */
const tick = async (times = 40): Promise<void> => {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
};

/**
 * The rotation the sway adds after it ran for some time: a straight walk out and back.
 *
 * @param elapsed - Milliseconds the sway has run.
 * @returns The offset on `Transform.rotation`.
 * @example
 * ```ts
 * swayAt(100); // 0.05
 * swayAt(416); // 0.008
 * ```
 */
function swayAt(elapsed: number): number {
  const phase = elapsed % SWAY_MS;
  const half = SWAY_MS / 2;

  return (SWAY_REACH * (phase <= half ? phase : SWAY_MS - phase)) / half;
}

/**
 * Starts an app that rests at `home` with one swaying piece, and counts the time its sway runs.
 *
 * @returns The app, the entity of the piece, a `step` that counts and the rotation of the sway now.
 */
async function startBoard() {
  const app = createApp({
    plugins: [worldPlugin, rendererPlugin, animPlugin, boardFeature],
    pluginConfigs: {
      flow: { mainFlow: main, safeNode: "home" },
      model: {
        initialPlayer: { pieces: [{ id: "p1", x: 100, y: 300, level: 1 }], cards: [] },
        initialSession: { launches: 0 },
        seed: 1
      }
    }
  });

  await app.start();
  app.flow.run().catch(() => undefined);
  await tick();

  app.world.projection.setLayers([{ name: "pieces", sort: "none" }]);
  app.world.projection.mount(["board.pieces", "board.cards"], { kind: "plugin", name: "test" });
  // The piece was mounted directly: this frame starts its sway, every later one moves it.
  app.time.step(16);

  expect(app.flow.state().path).toBe("home");
  expect(app.anim.active()).toBe(1);

  const clock = { swayed: 0 };

  return {
    app,
    entity: app.world.projection.entityOf("board.pieces", "p1") ?? 0,
    step: (ms: number): void => {
      app.time.step(ms);
      clock.swayed += ms;
    },
    sway: (): number => swayAt(clock.swayed)
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
 * Answers the gate, plays the timeline of the launch to its end and lets the node throw. The
 * loop rolls back and stands at `home` again.
 *
 * @param board - The started board, resting at `home`.
 */
async function launchAndFail(board: Board): Promise<void> {
  expect(board.app.flow.gate.answer({ intent: "go" })).toBe(true);
  await tick();
  board.step(16);
  board.step(400);
  await tick();

  expect(board.app.flow.state().path).toBe("home");
}

describe("world — a view that loops is brought home like any other", () => {
  it("a rollback settles a swaying view after every attempt of a node that moved it, and the sway runs on", async () => {
    const board = await startBoard();
    const { app, entity } = board;

    await launchAndFail(board);

    // The node awaited its timeline: the piece stands on the end pose, and only its sway runs.
    expect(app.world.ecs.get(entity, Transform)).toMatchObject({ x: 100, y: -900 });
    expect(app.anim.active()).toBe(1);

    board.step(16);

    // The settle of the rollback, next to the sway.
    expect(app.anim.active()).toBe(2);

    board.step(350);

    expect(app.world.ecs.get(entity, Transform)).toMatchObject({ x: 100, y: 300, scale: 1 });
    expect(app.world.ecs.get(entity, Transform)?.rotation).toBeCloseTo(board.sway(), 6);
    expect(app.anim.active()).toBe(1);

    // The second attempt uses up the retries: the loop gives up and stands on the safe node.
    await launchAndFail(board);

    expect(app.world.ecs.get(entity, Transform)).toMatchObject({ y: -900 });

    board.step(16);
    board.step(350);

    expect(app.world.projection.entityOf("board.pieces", "p1")).toBe(entity);
    expect(app.world.ecs.get(entity, Transform)).toMatchObject({ x: 100, y: 300, scale: 1 });
    expect(app.world.ecs.get(entity, Transform)?.rotation).toBeCloseTo(board.sway(), 6);
    expect(app.world.projection.motionsOf(entity)).toEqual(["Transform"]);
    expect(app.anim.active()).toBe(1);
    expect(corrected(board)).toBe(0);

    await app.stop();
  });

  it("a rollback leaves a swaying view that stands at home alone: the offset of its sway is no miss", async () => {
    const board = await startBoard();
    const { app, entity } = board;

    board.step(100);

    expect(app.flow.gate.answer({ intent: "trip" })).toBe(true);
    await tick();
    board.step(16);

    expect(app.flow.state().path).toBe("home");
    // No settle started: the sway is the one track.
    expect(app.anim.active()).toBe(1);
    expect(app.world.ecs.get(entity, Transform)).toMatchObject({ x: 100, y: 300, scale: 1 });
    expect(app.world.ecs.get(entity, Transform)?.rotation).toBeCloseTo(board.sway(), 6);

    await app.stop();
  });

  it("settle(entity) brings a swaying view home after a drop off its place, and the sway runs on", async () => {
    const board = await startBoard();
    const { app, entity } = board;

    board.step(100);
    // The hand let go of the piece somewhere else and no commit followed.
    app.world.ecs.set(entity, Transform, { x: 400, y: 50 });
    app.world.projection.settle(entity);

    expect(app.anim.active()).toBe(2);

    board.step(16);
    board.step(350);

    expect(app.world.ecs.get(entity, Transform)).toMatchObject({ x: 100, y: 300, scale: 1 });
    expect(app.world.ecs.get(entity, Transform)?.rotation).toBeCloseTo(board.sway(), 6);
    expect(app.anim.active()).toBe(1);
    expect(corrected(board)).toBe(0);

    await app.stop();
  });

  it("the settle of a changed item brings a swaying view home, and the sway runs on", async () => {
    const board = await startBoard();
    const { app, entity } = board;

    board.step(100);
    // An earlier motion left the piece off its place. The commit changes its level only.
    app.world.ecs.set(entity, Transform, { y: -900 });

    expect(app.flow.gate.answer({ intent: "grow" })).toBe(true);
    await tick();
    board.step(16);

    expect(app.world.ecs.get(entity, Level)).toEqual({ level: 2 });
    expect(app.anim.active()).toBe(2);

    board.step(350);

    expect(app.world.ecs.get(entity, Transform)).toMatchObject({ x: 100, y: 300, scale: 1 });
    expect(app.world.ecs.get(entity, Transform)?.rotation).toBeCloseTo(board.sway(), 6);
    expect(app.anim.active()).toBe(1);
    expect(corrected(board)).toBe(0);

    await app.stop();
  });

  it("the end of a motion does not take the offset of the loop for a miss: no correction, no jump", async () => {
    const board = await startBoard();
    const { app } = board;

    expect(app.flow.gate.answer({ intent: "deal" })).toBe(true);
    await tick();

    const seen: number[] = [];
    const swayed: number[] = [];

    // The card enters on the edge: its pop-in ends after 96 ms, its sway starts with it.
    for (let frame = 1; frame <= 12; frame += 1) {
      board.step(16);

      const card = app.world.projection.entityOf("board.cards", "c1") ?? 0;

      seen.push(app.world.ecs.get(card, Transform)?.rotation ?? -1);
      swayed.push(swayAt(16 * frame));
    }

    const card = app.world.projection.entityOf("board.cards", "c1") ?? 0;

    expect(seen.map(value => value.toFixed(6))).toEqual(swayed.map(value => value.toFixed(6)));
    expect(app.world.ecs.get(card, Transform)).toMatchObject({ x: 500, y: 300, scale: 1 });
    // The sway of the piece and the sway of the card.
    expect(app.anim.active()).toBe(2);
    expect(corrected(board)).toBe(0);

    await app.stop();
  });
});
