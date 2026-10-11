import { describe, expect, it } from "vitest";
import {
  animPlugin,
  createApp,
  defineAnimation,
  defineGame,
  exit,
  parallel,
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
// Integration: a rollback settles the views a failed node left off their rest
// pose. The node plays a timeline on two views, awaits it and throws, on every
// attempt. It commits nothing, so no item of the rollback is new: a piece is
// the very object of the rest point, and a ghost is a new object with the same
// content, as a `from` that maps builds it. The real time, lifecycle, model,
// clock, flow, world, renderer and anim plugins.
// ---------------------------------------------------------------------------

type Piece = { id: string; x: number; y: number };
type Player = { pieces: Piece[] };
type Session = { launches: number };

const { defineNode, defineFlow, defineFeature } = defineGame<{
  player: Player;
  session: Session;
  assets: string;
  strings: Record<string, unknown>;
}>();

const piece: Target = { projection: "board.pieces", key: "p1" };
const ghost: Target = { projection: "board.ghosts", key: "p1" };

/** The launch: both views fly off the screen in 400 ms. */
const fly = defineAnimation("board.fly", {
  slots: { piece: type<Target>(), ghost: type<Target>() },
  build: ({ piece: first, ghost: second }) =>
    parallel(
      tween(first, Transform, { y: -900 }, { ms: 400, ease: "linear" }),
      tween(second, Transform, { y: -900 }, { ms: 400, ease: "linear" })
    )
});

/** The pieces as the model holds them: a rollback hands out the same objects. */
const boardPieces = projection({
  name: "board.pieces",
  layer: "pieces",
  from: (player: Player) => player.pieces,
  key: (found: Piece) => found.id,
  view: (found: Piece) => [Transform({ x: found.x, y: found.y, rotation: 0, scale: 1 })]
});

/** The same pieces through a `from` that builds a new object on every commit. */
const boardGhosts = projection({
  name: "board.ghosts",
  layer: "pieces",
  from: (player: Player) => player.pieces.map(found => ({ ...found, x: found.x + 200 })),
  key: (found: Piece) => found.id,
  view: (found: Piece) => [Transform({ x: found.x, y: found.y, rotation: 0, scale: 1 })]
});

const home = defineNode({ rest: true, checkpoint: true, outcomes: { go: type(), quit: type() } });

const launch = defineNode({
  outcomes: { done: type() },
  run: async ({ session, fx }) => {
    session.launches += 1;
    await fx(play(fly, { piece, ghost }));

    throw new Error("the launch broke");
  }
});

const main = defineFlow("main", {
  nodes: { home, launch },
  start: "home",
  outcomes: { over: type() },
  edges: { home: { go: "launch", quit: exit("over") }, launch: { done: "home" } }
});

const boardFeature = defineFeature("board", {
  flows: [main],
  projections: [boardPieces, boardGhosts],
  animations: [fly]
});

/** Yields the microtask queue to the flow loop, the way a test waits without a timer. */
const tick = async (times = 40): Promise<void> => {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
};

/**
 * Starts an app that rests at `home`, with both projections mounted.
 *
 * @returns The started app.
 */
async function startBoard() {
  const app = createApp({
    plugins: [worldPlugin, rendererPlugin, animPlugin, boardFeature],
    pluginConfigs: {
      flow: { mainFlow: main, safeNode: "home" },
      model: {
        initialPlayer: { pieces: [{ id: "p1", x: 100, y: 300 }] },
        initialSession: { launches: 0 },
        seed: 1
      }
    }
  });

  await app.start();
  app.flow.run().catch(() => undefined);
  await tick();

  app.world.projection.setLayers([{ name: "pieces", sort: "none" }]);
  app.world.projection.mount(["board.pieces", "board.ghosts"], { kind: "plugin", name: "test" });
  // One frame drains the dirty record the boot of the graph left.
  app.time.step(16);

  expect(app.flow.state().path).toBe("home");

  return app;
}

/**
 * Answers the gate, plays the timeline of the launch to its end and lets the node throw. The
 * loop rolls back and stands at `home` again.
 *
 * @param app - The started app, resting at `home`.
 */
async function launchAndFail(app: Awaited<ReturnType<typeof startBoard>>): Promise<void> {
  expect(app.flow.gate.answer({ intent: "go" })).toBe(true);
  await tick();
  app.time.step(16);
  app.time.step(400);
  await tick();

  expect(app.flow.state().path).toBe("home");
}

describe("world — a rollback settles the views a failed node moved", () => {
  it("brings both views home after every attempt of a node that tweens them and throws", async () => {
    const app = await startBoard();
    const first = app.world.projection.entityOf("board.pieces", "p1") ?? 0;
    const second = app.world.projection.entityOf("board.ghosts", "p1") ?? 0;

    await launchAndFail(app);

    // The node awaited its timeline: both views stand on its end pose, and nothing was committed.
    expect(app.world.ecs.get(first, Transform)).toMatchObject({ x: 100, y: -900 });
    expect(app.world.ecs.get(second, Transform)).toMatchObject({ x: 300, y: -900 });
    expect(app.model.store.snapshot().session).toEqual({ launches: 0 });
    expect(app.anim.active()).toBe(0);

    // The frame after the rollback starts the settle of each view: a motion, not a jump.
    app.time.step(16);

    expect(app.anim.active()).toBe(2);

    app.time.step(150);

    expect(app.world.ecs.get(first, Transform)?.y).toBeGreaterThan(-900);
    expect(app.world.ecs.get(first, Transform)?.y).toBeLessThan(300);
    expect(app.world.ecs.get(second, Transform)?.y).toBeGreaterThan(-900);
    expect(app.world.ecs.get(second, Transform)?.y).toBeLessThan(300);

    app.time.step(200);

    expect(app.world.ecs.get(first, Transform)).toMatchObject({
      x: 100,
      y: 300,
      rotation: 0,
      scale: 1
    });
    expect(app.world.ecs.get(second, Transform)).toMatchObject({
      x: 300,
      y: 300,
      rotation: 0,
      scale: 1
    });
    expect(app.anim.active()).toBe(0);

    // The second attempt uses up the retries: the loop gives up and stands on the safe node.
    await launchAndFail(app);

    expect(app.world.ecs.get(first, Transform)).toMatchObject({ y: -900 });
    expect(app.world.ecs.get(second, Transform)).toMatchObject({ y: -900 });

    app.time.step(16);
    app.time.step(350);

    expect(app.world.projection.entityOf("board.pieces", "p1")).toBe(first);
    expect(app.world.projection.entityOf("board.ghosts", "p1")).toBe(second);
    expect(app.world.ecs.get(first, Transform)).toMatchObject({ x: 100, y: 300 });
    expect(app.world.ecs.get(second, Transform)).toMatchObject({ x: 300, y: 300 });
    expect(app.anim.active()).toBe(0);
    expect(
      app.log
        .trace()
        .filter(entry => entry.event === "flow:error")
        .map(entry => entry.data)
    ).toEqual([
      expect.objectContaining({ path: "launch", rolledBackTo: "home", retry: true }),
      expect.objectContaining({ path: "launch", rolledBackTo: "home", retry: false })
    ]);

    await app.stop();
  });
});
