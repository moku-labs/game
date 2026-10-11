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
// Integration: a restore converges the views an aborted animation left behind.
// The splash pieces come from one frozen table, so `from` hands out the very
// same item objects for the same state and no item of the restore is new. The
// real time, lifecycle, model, clock, flow, world, renderer and anim plugins.
// ---------------------------------------------------------------------------

type Piece = { readonly id: string; readonly x: number; readonly y: number };
type Player = { phase: "intro" | "splash" | "board" };
type Session = { starts: number };

const { defineNode, defineFlow, defineFeature } = defineGame<{
  player: Player;
  session: Session;
  assets: string;
  strings: Record<string, unknown>;
}>();

/** The pieces of the splash: constants, not model items. */
const PIECES: readonly Piece[] = Object.freeze([Object.freeze({ id: "p1", x: 100, y: 300 })]);

/** Nothing to draw outside the splash. */
const NO_PIECES: readonly Piece[] = Object.freeze([]);

const piece: Target = { projection: "splash.pieces", key: "p1" };

/** The exit of the splash: the piece flies off the screen and turns on the way. */
const leaveSplash = defineAnimation("splash.leave", {
  slots: { piece: type<Target>() },
  build: ({ piece: target }) =>
    tween(target, Transform, { y: -900, rotation: 3 }, { ms: 400, ease: "linear" })
});

/** A sway of 400 ms the pieces play for as long as they live. */
const sway = defineMotion({
  keyframes: {
    sway: [
      { at: 0, Transform: { rotation: 0 } },
      { at: 0.5, ease: "linear", Transform: { rotation: 0.1 } },
      { at: 1, ease: "linear", Transform: { rotation: 0 } }
    ]
  },
  transition: { ms: 400 },
  loop: { track: "sway" },
  on: {}
});

const splashPieces = projection({
  name: "splash.pieces",
  layer: "pieces",
  from: (player: Player) => (player.phase === "splash" ? PIECES : NO_PIECES),
  key: (found: Piece) => found.id,
  view: (found: Piece) => [Transform({ x: found.x, y: found.y, rotation: 0, scale: 1 })],
  motion: sway
});

const intro = defineNode({ rest: true, outcomes: { show: type() } });

const show = defineNode({
  outcomes: { done: type() },
  run: ({ player, out }) => {
    player.phase = "splash";

    return out.done();
  }
});

const splash = defineNode({ rest: true, checkpoint: true, outcomes: { start: type() } });

const leave = defineNode({
  outcomes: { done: type() },
  run: async ({ player, session, fx, out }) => {
    await fx(play(leaveSplash, { piece }));
    player.phase = "board";
    session.starts += 1;

    return out.done();
  }
});

const board = defineNode({ rest: true, outcomes: { quit: type() } });

const main = defineFlow("main", {
  nodes: { intro, show, splash, leave, board },
  start: "intro",
  outcomes: { over: type() },
  edges: {
    intro: { show: "show" },
    show: { done: "splash" },
    splash: { start: "leave" },
    leave: { done: "board" },
    board: { quit: exit("over") }
  }
});

const splashFeature = defineFeature("splash", {
  flows: [main],
  projections: [splashPieces],
  animations: [leaveSplash]
});

/** Yields the microtask queue to the flow loop, the way a test waits without a timer. */
const tick = async (times = 40): Promise<void> => {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
};

/**
 * Starts an app that rests at the splash, with its pieces mounted.
 *
 * @param phase - `"splash"` mounts the pieces directly; `"intro"` lets them enter on an edge, so
 *   their sway plays.
 * @returns The started app, resting at the node `splash`.
 */
async function startSplash(phase: "intro" | "splash") {
  const app = createApp({
    plugins: [worldPlugin, rendererPlugin, animPlugin, splashFeature],
    pluginConfigs: {
      flow: { mainFlow: main },
      model: { initialPlayer: { phase }, initialSession: { starts: 0 }, seed: 1 }
    }
  });

  await app.start();
  app.flow.run().catch(() => undefined);
  await tick();

  app.world.projection.setLayers([{ name: "pieces", sort: "none" }]);
  app.world.projection.mount(["splash.pieces"], { kind: "plugin", name: "test" });
  // One frame drains the dirty record the boot of the graph left.
  app.time.step(16);

  expect(app.flow.gate.answer({ intent: "show" })).toBe(true);
  await tick();
  app.time.step(16);

  expect(app.flow.state().path).toBe("splash");

  return app;
}

describe("world — a restore converges the views of an aborted animation", () => {
  it("brings a piece of a frozen table back from the end pose of the exit animation", async () => {
    const app = await startSplash("splash");
    const entity = app.world.projection.entityOf("splash.pieces", "p1") ?? 0;
    const bookmark = app.flow.bookmark();

    expect(app.flow.gate.answer({ intent: "start" })).toBe(true);
    await tick();
    app.time.step(16);
    app.time.step(100);

    expect(app.anim.active()).toBe(1);
    expect(app.world.ecs.get(entity, Transform)?.y).toBeLessThan(300);

    // The restore aborts the node, and `anim` finishes its timeline: the piece is off the screen.
    await app.flow.restore(bookmark);

    expect(app.world.ecs.get(entity, Transform)).toMatchObject({ y: -900, rotation: 3 });

    app.time.step(16);

    expect(app.flow.state().path).toBe("splash");
    expect(app.world.projection.entityOf("splash.pieces", "p1")).toBe(entity);
    expect(app.world.ecs.get(entity, Transform)).toMatchObject({
      x: 100,
      y: 300,
      rotation: 0,
      scale: 1
    });
    expect(app.anim.active()).toBe(0);

    app.time.step(100);

    expect(app.world.ecs.get(entity, Transform)).toMatchObject({ x: 100, y: 300, rotation: 0 });

    await app.stop();
  });

  it("also when a loop of the view still adds to a field the animation ended on", async () => {
    const app = await startSplash("intro");
    const entity = app.world.projection.entityOf("splash.pieces", "p1") ?? 0;
    const bookmark = app.flow.bookmark();

    // The piece entered on an edge, so its sway runs.
    expect(app.anim.active()).toBe(1);

    expect(app.flow.gate.answer({ intent: "start" })).toBe(true);
    await tick();
    app.time.step(16);
    app.time.step(100);

    expect(app.anim.active()).toBe(2);

    await app.flow.restore(bookmark);
    app.time.step(16);

    expect(app.world.projection.entityOf("splash.pieces", "p1")).toBe(entity);
    expect(app.world.ecs.get(entity, Transform)).toMatchObject({
      x: 100,
      y: 300,
      rotation: 0,
      scale: 1
    });
    expect(app.anim.active()).toBe(0);

    app.time.step(100);

    expect(app.world.ecs.get(entity, Transform)).toMatchObject({ x: 100, y: 300, rotation: 0 });

    await app.stop();
  });
});
