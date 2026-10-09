import { describe, expect, it } from "vitest";
import {
  createApp,
  createPlugin,
  defineGame,
  exit,
  flowPlugin,
  guide,
  schedule,
  type
} from "../../../../index";
import { fakeClock } from "../../../clock/fake";
import { memory } from "../../../model/store/providers/memory";
import type { Json } from "../../../model/types";
import { reproBookmark } from "../../headless";
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

// eslint-disable-next-line unicorn/no-null -- `null` is the JSON value for "no payload".
const noPayload: Json = null;

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

// ─── a game that shows a guide and a popup ────────────────────

const teach = defineNode({
  outcomes: { taught: type() },
  run: async ({ fx, out }) => {
    await fx(guide({ allow: { intent: "merge" }, target: { projection: "hud", key: "order" } }));
    return out.taught();
  }
});

const claim = defineNode({
  outcomes: { claimed: type() },
  run: async ({ fx, out }) => {
    await fx({ kind: "popup", payload: { component: "RewardPopup" }, answers: ["claim"] });
    return out.claimed();
  }
});

const idle = defineNode({ rest: true, checkpoint: true, outcomes: { again: type() } });

const guidedFlow = defineFlow("guided", {
  nodes: { teach, claim, idle },
  start: "teach",
  edges: { teach: { taught: "claim" }, claim: { claimed: "idle" }, idle: { again: "teach" } }
});

/** What the two interface handlers were shown, and with which signal. */
const capture = (): { guides: AbortSignal[]; popups: AbortSignal[]; targets: unknown[] } => ({
  guides: [],
  popups: [],
  targets: []
});

const createGuidedGame = () =>
  createApp({
    pluginConfigs: {
      model: {
        playerProvider: memory(),
        seed: 7,
        initialPlayer: { coins: 0, merges: 0 },
        initialSession: { popups: 0 }
      },
      clock: { source: fakeClock(1000) },
      flow: { mainFlow: guidedFlow }
    }
  });

const startGuidedGame = async (
  game: ReturnType<typeof createGuidedGame>,
  shown: ReturnType<typeof capture>
): Promise<void> => {
  await game.start();
  game.flow.fx.handle("guide", (descriptor, { signal }) => {
    shown.guides.push(signal);
    shown.targets.push(descriptor.payload);
  });
  game.flow.fx.handle("popup", (_descriptor, { signal }) => {
    shown.popups.push(signal);
  });
  game.flow.run().catch(() => undefined);
  await tick();
};

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

// ─── a bookmark at a node that waits for a popup ──────────────

/**
 * Starts a game whose popup handler records what it was asked to show, and how.
 *
 * @returns The game and the popups it showed.
 */
const startShowing = async () => {
  const game = createGame();
  const shown: { mode: string; signal: AbortSignal }[] = [];

  await game.app.start();
  game.app.flow.fx.handle("popup", (_descriptor, { mode, signal }) => {
    shown.push({ mode, signal });
  });
  game.app.flow.run().catch(() => undefined);
  await tick();

  return { ...game, shown };
};

/**
 * Plays a game up to the popup of `noLives` and takes the bookmark there.
 *
 * @returns The game, standing at the popup, and the bookmark as JSON.
 */
const bookmarkAtPopup = async () => {
  const game = await startShowing();

  game.app.flow.gate.answer({ intent: "play" });
  await tick();

  return { game, bookmark: structuredClone(game.app.flow.bookmark()) };
};

describe("a bookmark taken while a popup waits", () => {
  it("names the waiting node, the state it was entered with and the rest point before it", async () => {
    const { game, bookmark } = await bookmarkAtPopup();

    // `noLives` counted the popup before it waited: the count is in its open transaction only.
    expect(bookmark).toEqual({
      path: "noLives",
      input: noPayload,
      player: { coins: 3, merges: 0 },
      session: { popups: 0 },
      rng: { seed: 7, streams: {} },
      graph: bookmark.graph,
      rest: { path: "home", input: noPayload }
    });

    await game.app.stop();
  });

  it("comes back in a fresh game with the popup shown and its gate open", async () => {
    const { game: first, bookmark } = await bookmarkAtPopup();

    await first.app.stop();

    const game = await startShowing();

    await game.app.flow.restore(bookmark);

    expect(game.app.flow.state()).toMatchObject({ path: "noLives", pending: { gate: ["close"] } });
    expect(game.shown.map(popup => popup.mode)).toEqual(["live"]);

    game.app.flow.gate.answer({ intent: "close" });
    await tick();

    // The node ran once more from its first line: the popup is counted once, not twice.
    expect(game.app.flow.state().path).toBe("board/awaitIntent");
    expect(game.app.model.store.snapshot().session).toEqual({ popups: 1 });
    expect(game.edges).toEqual(["closed"]);

    await game.app.stop();
  });

  it("comes back in the same game: the old popup is taken down, one waits again", async () => {
    const { game, bookmark } = await bookmarkAtPopup();

    await game.app.flow.restore(bookmark);

    expect(game.shown).toHaveLength(2);
    expect(game.shown[0]?.signal.reason).toBe("restore");
    expect(game.shown[1]?.signal.aborted).toBe(false);
    expect(game.app.flow.state()).toMatchObject({ path: "noLives", pending: { gate: ["close"] } });

    game.app.flow.gate.answer({ intent: "close" });
    await tick();

    expect(game.app.model.store.snapshot().session).toEqual({ popups: 1 });

    await game.app.stop();
  });

  it("walks on from the bookmark in fast mode without showing the popup", async () => {
    const { game: first, bookmark } = await bookmarkAtPopup();

    await first.app.stop();

    const game = await startShowing();
    const state = await game.app.flow.walk([{ at: "noLives", intent: "close" }], {
      from: bookmark
    });

    expect(state).toMatchObject({ path: "board/awaitIntent", mode: "live" });
    expect(game.shown).toEqual([]);

    await game.app.stop();
  });

  it("falls back to the checkpoint before it when the graph changed, and says so in the log", async () => {
    const { game: first, bookmark } = await bookmarkAtPopup();

    await first.app.stop();

    const game = await startShowing();

    await game.app.flow.restore({ ...bookmark, graph: "00000000" });
    await tick();

    expect(game.app.flow.state()).toMatchObject({
      path: "home",
      pending: { gate: ["play", "pause"] }
    });
    expect(game.shown).toEqual([]);
    expect(game.app.log.trace()).toContainEqual(
      expect.objectContaining({
        event: "flow:restore-fell-back",
        data: { from: "noLives", to: "home" }
      })
    );

    await game.app.stop();
  });

  it("is refused as a repro checkpoint: a repro starts at a rest node", async () => {
    const game = await startShowing();

    expect(() =>
      reproBookmark(game.app, { player: { coins: 3, merges: 0 }, checkpoint: "noLives", route: [] })
    ).toThrow(
      '[game] The bookmark "noLives" is not a rest node of the graph.\n  Restore a rest node, for example the checkpoint "home".'
    );

    await game.app.stop();
  });
});

// ─── the interface effects: a guide and a popup ───────────────

describe("the signal of an interface effect", () => {
  it("aborts the guide handler when the runner lifts the narrow", async () => {
    const game = createGuidedGame();
    const shown = capture();

    await startGuidedGame(game, shown);

    expect(shown.guides).toHaveLength(1);
    expect(shown.targets[0]).toEqual({
      allow: { intent: "merge" },
      target: { projection: "hud", key: "order" }
    });
    expect(shown.guides[0]?.aborted).toBe(true);
    expect(game.flow.gate.state().narrowed).toBe(false);

    await game.stop();
  });

  it("aborts the popup handler when the answer arrives", async () => {
    const game = createGuidedGame();
    const shown = capture();

    await startGuidedGame(game, shown);

    expect(game.flow.state().path).toBe("claim");
    expect(shown.popups[0]?.aborted).toBe(false);

    game.flow.gate.answer({ intent: "claim" });
    await tick();

    expect(game.flow.state().path).toBe("idle");
    expect(shown.popups[0]?.aborted).toBe(true);

    await game.stop();
  });

  it("leaves the popup handler running while the node waits for the answer", async () => {
    const game = createGuidedGame();
    const shown = capture();

    await startGuidedGame(game, shown);

    expect(shown.popups).toHaveLength(1);
    expect(shown.popups[0]?.aborted).toBe(false);

    await game.stop();

    expect(shown.popups[0]?.aborted).toBe(true);
  });
});
