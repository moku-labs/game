import { describe, expect, it, vi } from "vitest";
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

// ─── a game whose gate stays closed while an effect plays ─────

const table = defineNode({ rest: true, checkpoint: true, outcomes: { deal: type() } });

const dealCards = defineNode({
  outcomes: { dealt: type() },
  run: async ({ fx, out }) => {
    await fx({ kind: "deal" });
    return out.dealt();
  }
});

const hand = defineNode({ rest: true, outcomes: { tap: type() } });

const played = defineNode({ rest: true, outcomes: { again: type() } });

const dealFlow = defineFlow("deal", {
  nodes: { table, dealCards, hand, played },
  start: "table",
  edges: {
    table: { deal: "dealCards" },
    dealCards: { dealt: "hand" },
    hand: { tap: "played" },
    played: { again: "table" }
  }
});

/**
 * Plays the case measured in the demo game: the player presses at the start of a transition whose
 * effect keeps the gate closed for 1008 ms of game time. The frame source is the platform seam:
 * with one, `time` runs and the gate holds.
 *
 * @param holdMs - The configured hold time.
 * @returns Whether the press was accepted at once, and where the graph stands afterwards.
 */
const pressWhileDealing = async (holdMs: number) => {
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => undefined);

  try {
    const app = createApp({
      pluginConfigs: {
        model: {
          playerProvider: memory(),
          seed: 7,
          initialPlayer: { coins: 0, merges: 0 },
          initialSession: { popups: 0 }
        },
        clock: { source: fakeClock(1000) },
        flow: { mainFlow: dealFlow, holdMs }
      }
    });
    const dealt = Promise.withResolvers<void>();

    await app.start();
    app.flow.fx.handle("deal", () => dealt.promise);
    app.flow.run().catch(() => undefined);
    await tick();

    const running = app.time.isRunning();

    app.flow.gate.answer({ intent: "deal" });
    await tick();

    // `dealCards` awaits its effect: the gate is closed. The player presses now.
    const waiting = app.flow.state().path;
    const accepted = app.flow.gate.answer({ intent: "tap" });

    app.time.step(504);
    await tick();
    dealt.resolve();
    await tick();
    // The completion of an effect waits for the `signals` phase of the next frame.
    app.time.step(504);
    await tick();

    const outcome = {
      running,
      waiting,
      accepted,
      elapsed: app.time.snapshot().elapsed,
      state: app.flow.state()
    };

    await app.stop();

    return outcome;
  } finally {
    vi.unstubAllGlobals();
  }
};

// ─── a game whose node starts a sound and goes on ─────────────

const counter = defineNode({ rest: true, checkpoint: true, outcomes: { tap: type() } });

const countTap = defineNode({
  outcomes: { counted: type() },
  run: ({ fx, player, out }) => {
    // Started, not awaited: the sound plays while the edge commits.
    fx.start({ kind: "jingle", payload: { key: "ui.tap" } });
    player.coins += 1;

    return out.counted();
  }
});

const tapFlow = defineFlow("tap", {
  nodes: { counter, countTap },
  start: "counter",
  edges: { counter: { tap: "countTap" }, countTap: { counted: "counter" } }
});

const createTapGame = () =>
  createApp({
    pluginConfigs: {
      model: {
        playerProvider: memory(),
        seed: 7,
        initialPlayer: { coins: 0, merges: 0 },
        initialSession: { popups: 0 }
      },
      clock: { source: fakeClock(1000) },
      flow: { mainFlow: tapFlow }
    }
  });

// ─── a game whose board transition fails on every attempt ─────

type Match = { screen: "home" | "board"; marks: number };

const match = defineGame<{
  player: Player;
  session: Match;
  assets: string;
  strings: Record<string, unknown>;
}>();

const menu = match.defineNode({
  rest: true,
  checkpoint: true,
  outcomes: { play: type(), mark: type() },
  recover: ({ session }) => {
    session.screen = "home";
    session.marks = 0;
  }
});

const enterBoard = match.defineNode({
  outcomes: { entered: type() },
  run: ({ session, out }) => {
    session.screen = "board";
    session.marks = 1;
    return out.entered();
  }
});

const turn = match.defineNode({ rest: true, outcomes: { mark: type() } });

const placeMark = match.defineNode({
  outcomes: { placed: type() },
  run: ({ session }) => {
    // The change happens before the throw: only a committed edge may keep it.
    session.marks += 1;

    throw new Error("the board broke");
  }
});

const matchFlow = match.defineFlow("match", {
  nodes: { home: menu, enterBoard, turn, placeMark },
  start: "home",
  edges: {
    home: { play: "enterBoard", mark: "placeMark" },
    enterBoard: { entered: "turn" },
    turn: { mark: "placeMark" },
    placeMark: { placed: "turn" }
  }
});

const createMatchGame = () => {
  const edges: { node: string; outcome: string; next: string }[] = [];
  const failures: { path: string; rolledBackTo: string; retry: boolean }[] = [];
  const edgeLog = createPlugin("edgeLog", {
    depends: [flowPlugin],
    hooks: () => ({
      "flow:edge": payload => {
        edges.push({ node: payload.node, outcome: payload.outcome, next: payload.next });
      },
      "flow:error": payload => {
        failures.push({
          path: payload.path,
          rolledBackTo: payload.rolledBackTo,
          retry: payload.retry
        });
      }
    })
  });
  const app = createApp({
    plugins: [edgeLog],
    pluginConfigs: {
      model: {
        playerProvider: memory(),
        seed: 7,
        initialPlayer: { coins: 0, merges: 0 },
        initialSession: { screen: "home", marks: 0 }
      },
      clock: { source: fakeClock(1000) },
      flow: { mainFlow: matchFlow, safeNode: "home" }
    }
  });

  return { app, edges, failures };
};

/**
 * Plays the match until the loop gives up: the board rests with its own session, `placeMark`
 * fails, is retried from the board and fails again. The loop then stands on the safe node `home`.
 *
 * @param game - The match game.
 */
const playUntilGiveUp = async (game: ReturnType<typeof createMatchGame>): Promise<void> => {
  await game.app.start();
  game.app.flow.run().catch(() => undefined);
  await tick();

  game.app.flow.gate.answer({ intent: "play" });
  await tick();
  game.app.flow.gate.answer({ intent: "mark" });
  await tick();
  game.app.flow.gate.answer({ intent: "mark" });
  await tick();
};

/** Reads the `flow:error` entries of the log, in order. */
const errorEntries = (game: ReturnType<typeof createMatchGame>) =>
  game.app.log.trace().filter(entry => entry.event === "flow:error");

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

// ─── an effect a node starts and does not await ───────────────

describe("an effect started with fx.start", () => {
  it("lets the edge commit before its handler resolves", async () => {
    const app = createTapGame();
    const played = Promise.withResolvers<void>();
    const sounds: unknown[] = [];

    await app.start();
    app.flow.fx.handle("jingle", descriptor => {
      sounds.push(descriptor.payload);

      return played.promise;
    });
    app.flow.run().catch(() => undefined);
    await tick();

    app.flow.gate.answer({ intent: "tap" });
    await tick();

    // The sound is still playing: the edge is committed and the next gate is open.
    expect(sounds).toEqual([{ key: "ui.tap" }]);
    expect(app.model.store.snapshot().player).toMatchObject({ coins: 1 });
    expect(app.flow.state()).toMatchObject({ path: "counter", pending: { gate: ["tap"] } });

    played.resolve();
    await tick();

    // The end of the sound moves nothing and is no log entry.
    expect(app.flow.state()).toMatchObject({ path: "counter", pending: { gate: ["tap"] } });
    expect(app.log.trace().filter(entry => entry.level === "error")).toEqual([]);

    await app.stop();
  });
});

// ─── an answer given while the gate is closed ─────────────────

describe("an answer given while the gate is closed", () => {
  it("is taken by the rest node that opens 1008 ms later, with holdMs 1100", async () => {
    const outcome = await pressWhileDealing(1100);

    // The press was refused at the closed gate, kept, and answered `hand` when it opened.
    expect(outcome).toMatchObject({
      running: true,
      waiting: "dealCards",
      accepted: false,
      elapsed: 1008,
      state: { path: "played", pending: { gate: ["again"] } }
    });
  });

  it("is lost when the gate opens 1008 ms later, with holdMs 500", async () => {
    const outcome = await pressWhileDealing(500);

    expect(outcome).toMatchObject({
      accepted: false,
      elapsed: 1008,
      state: { path: "hand", pending: { gate: ["tap"] } }
    });
  });
});

// ─── a transition that fails on every attempt ─────────────────

describe("a transition that fails on every attempt", () => {
  it("writes one flow:error entry per failure to the log: the retry, then the give-up", async () => {
    const game = createMatchGame();

    await playUntilGiveUp(game);

    expect(errorEntries(game)).toEqual([
      expect.objectContaining({
        level: "error",
        data: expect.objectContaining({ path: "placeMark", rolledBackTo: "turn", retry: true })
      }),
      expect.objectContaining({
        level: "error",
        data: expect.objectContaining({ path: "placeMark", rolledBackTo: "home", retry: false })
      })
    ]);
    expect(errorEntries(game)[0]?.data).toMatchObject({ error: { message: "the board broke" } });

    await game.app.stop();
  });

  it("opens the gate of the safe node on the session its recover committed", async () => {
    const game = createMatchGame();

    await playUntilGiveUp(game);

    expect(game.app.flow.state()).toMatchObject({
      path: "home",
      pending: { gate: ["play", "mark"] }
    });
    // The rollback left the session of the board, { screen: "board", marks: 1 }: `recover` put it right.
    expect(game.app.model.store.snapshot().session).toEqual({ screen: "home", marks: 0 });
    expect(game.edges.map(edge => edge.outcome)).toEqual([
      "play",
      "entered",
      "mark",
      "mark",
      "recover"
    ]);
    expect(game.edges.at(-1)).toEqual({ node: "home", outcome: "recover", next: "home" });

    await game.app.stop();
  });

  it("rolls a later failed transition back to the recovered state, not to the one before it", async () => {
    const game = createMatchGame();

    await playUntilGiveUp(game);

    // `placeMark` fails straight from `home` this time: a retry, back at `home`.
    game.app.flow.gate.answer({ intent: "mark" });
    await tick();

    expect(game.failures).toEqual([
      { path: "placeMark", rolledBackTo: "turn", retry: true },
      { path: "placeMark", rolledBackTo: "home", retry: false },
      { path: "placeMark", rolledBackTo: "home", retry: true }
    ]);
    expect(game.app.flow.state()).toMatchObject({
      path: "home",
      pending: { gate: ["play", "mark"] }
    });
    // The recovery is a committed edge and a rest mark: the rollback returns to it.
    expect(game.app.model.store.snapshot().session).toEqual({ screen: "home", marks: 0 });
    // The retry entered `home` again and ran no second recovery.
    expect(game.edges.filter(edge => edge.outcome === "recover")).toHaveLength(1);

    await game.app.stop();
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
