import { describe, expect, it } from "vitest";
import {
  createApp,
  createPlugin,
  defineGame,
  exit,
  flowPlugin,
  schedule,
  type
} from "../../../../index";
import { fakeClock } from "../../../clock/fake";
import { memory } from "../../../model/store/providers/memory";
import type { AnyFlow } from "../../runner/types";

// ---------------------------------------------------------------------------
// Integration: the real time, lifecycle, model, clock and flow plugins
// ---------------------------------------------------------------------------

type Player = { coins: number; merges: number };
type Session = { popups: number };

const { defineNode, defineFlow, defineFeature } = defineGame<{
  player: Player;
  session: Session;
  assets: string;
  strings: Record<string, unknown>;
}>();

/** Yields the microtask queue to the loop, the way a test waits without a timer. */
const tick = async (times = 40): Promise<void> => {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
};

// ─── the board sub-flow, driven by walk ───────────────────────

const awaitIntent = defineNode({
  outcomes: { merge: type<{ cell: string }>(), quit: type() },
  rest: true
});

const apply = defineNode({
  input: type<{ cell: string }>(),
  outcomes: { done: type() },
  run: ({ player, out }) => {
    player.merges += 1;
    return out.done();
  }
});

const board = defineFlow("board", {
  nodes: { awaitIntent, apply },
  start: "awaitIntent",
  outcomes: { won: type(), left: type() },
  edges: {
    awaitIntent: { merge: "apply", quit: exit("left") },
    apply: { done: exit("won") }
  }
});

// ─── the main flow ────────────────────────────────────────────

const home = defineNode({
  outcomes: { play: type(), pause: type() },
  rest: true,
  checkpoint: true
});

const noLives = defineNode({
  outcomes: { closed: type() },
  run: async ({ fx, session, out }) => {
    session.popups += 1;
    await fx({ kind: "popup", answers: ["close"] });
    return out.closed();
  }
});

const armTimer = defineNode({
  outcomes: { armed: type() },
  run: async ({ fx, now, out }) => {
    await fx(schedule(now + 1000));
    return out.armed();
  }
});

const cooldown = defineNode({
  outcomes: { elapsed: type<{ now: number }>(), skip: type() },
  rest: true,
  inbox: ["elapsed"]
});

const main = defineFlow("main", {
  nodes: { home, noLives, board, armTimer, cooldown },
  start: "home",
  edges: {
    home: { play: "noLives", pause: "armTimer" },
    noLives: { closed: "board" },
    board: { won: "home", left: "home" },
    armTimer: { armed: "cooldown" },
    cooldown: { elapsed: "home", skip: "home" }
  }
});

const scoringFeature = defineFeature("scoring", { nodes: [apply], flows: [board] });

// ─── a game whose nodes name their scene ──────────────────────

const lobby = defineNode({
  scene: "lobby",
  rest: true,
  checkpoint: true,
  outcomes: { go: type() }
});

const lobbyFlow = defineFlow("lobby", {
  nodes: { lobby },
  start: "lobby",
  edges: { lobby: { go: "lobby" } }
});

const wrongScene = defineNode({
  scene: "lobyy",
  rest: true,
  checkpoint: true,
  outcomes: { go: type() }
});

const wrongFlow = defineFlow("wrong", {
  nodes: { wrongScene },
  start: "wrongScene",
  edges: { wrongScene: { go: "wrongScene" } }
});

const sceneryFeature = defineFeature("scenery", {
  flows: [lobbyFlow],
  scenes: [{ id: "lobby" }]
});

const createSceneGame = (mainFlow: AnyFlow, logicOnly: boolean) =>
  createApp({
    plugins: [logicOnly ? sceneryFeature.logicOnly : sceneryFeature],
    pluginConfigs: {
      model: {
        playerProvider: memory(),
        seed: 7,
        initialPlayer: { coins: 0, merges: 0 },
        initialSession: { popups: 0 }
      },
      clock: { source: fakeClock(1000) },
      flow: { mainFlow }
    }
  });

const createGame = () => {
  const provider = memory();
  const clock = fakeClock(1000);
  const edges: string[] = [];
  const edgeLog = createPlugin("edgeLog", {
    depends: [flowPlugin],
    hooks: () => ({
      "flow:edge": payload => {
        edges.push(payload.outcome);
      }
    })
  });
  const app = createApp({
    plugins: [scoringFeature, edgeLog],
    pluginConfigs: {
      model: {
        playerProvider: provider,
        seed: 7,
        initialPlayer: { coins: 3, merges: 0 },
        initialSession: { popups: 0 }
      },
      clock: { source: clock },
      flow: { mainFlow: main }
    }
  });

  return { app, clock, edges, provider };
};

const startGame = async (game: ReturnType<typeof createGame>): Promise<void> => {
  await game.app.start();
  game.app.flow.fx.handle("popup", () => undefined);
  game.app.flow.run().catch(() => undefined);
  await tick();
};

describe("flow plugin", () => {
  it("registers the description of a feature plugin with flow.features", async () => {
    const game = createGame();

    await game.app.start();

    expect(game.app.flow.features.all().map(feature => feature.name)).toEqual(["scoring"]);
    expect(game.app.flow.describe().flows.board?.start).toBe("awaitIntent");

    await game.app.stop();
  });

  it("answers the popup of a node through the gate and walks the board sub-flow", async () => {
    const game = createGame();

    await startGame(game);
    expect(game.app.flow.state().path).toBe("home");

    game.app.flow.gate.answer({ intent: "play" });
    await tick();

    expect(game.app.flow.state().path).toBe("noLives");
    expect(game.app.flow.gate.state().allowed).toEqual(["close"]);

    game.app.flow.gate.answer({ intent: "close" });
    await tick();

    expect(game.app.flow.state().path).toBe("board/awaitIntent");

    const state = await game.app.flow.walk([
      { at: "board/awaitIntent", intent: "merge", payload: { cell: "c3" } }
    ]);

    expect(state.path).toBe("home");
    expect(game.app.model.store.snapshot().player).toMatchObject({ merges: 1 });
    // The exit of the sub-flow is collapsed into the edge of the node that produced it.
    expect(game.edges).toEqual(["play", "closed", "merge", "done"]);

    await game.app.stop();
  });

  it("delivers an elapsed event from the clock to a rest node that declares it", async () => {
    const game = createGame();

    await startGame(game);

    game.app.flow.gate.answer({ intent: "pause" });
    await tick();

    expect(game.app.flow.state().path).toBe("cooldown");

    game.clock.advance(2000);
    await tick();

    expect(game.app.flow.state().path).toBe("home");
    expect(game.edges).toEqual(["pause", "armed", "elapsed"]);

    await game.app.stop();
  });

  it("runs a logicOnly app whose nodes name a scene", async () => {
    const app = createSceneGame(lobbyFlow, true);

    await app.start();
    app.flow.run().catch(() => undefined);
    await tick();

    expect(app.flow.state().path).toBe("lobby");
    expect(app.flow.describe().flows.lobby?.nodes.lobby?.scene).toBe("lobby");
    expect(app.flow.features.all()[0]?.description.scenes).toBeUndefined();

    await app.stop();
  });

  it("reports an unknown scene id of a node in the error of run()", async () => {
    const app = createSceneGame(wrongFlow, false);

    await app.start();

    await expect(app.flow.run()).rejects.toThrow(
      '[game] Flow "wrong": the scene "lobyy" of node "wrongScene" is not registered.'
    );

    await app.stop();
  });

  it("settles app.stop() while the graph waits at a rest node", async () => {
    const game = createGame();

    await startGame(game);
    expect(game.app.flow.state().path).toBe("home");

    await game.app.stop();

    expect(game.app.flow.state().running).toBe(false);
    expect(game.provider.calls.map(call => call.method)).toContain("load");
  });
});
