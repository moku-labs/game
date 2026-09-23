import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, defineGame, exit, type } from "../../../../index";
import { fakeClock } from "../../../clock/fake";
import { memory } from "../../../model/store/providers/memory";
import { answerCommand, bookmarkCommand, restoreCommand, walkCommand } from "../../control";
import { read, watch } from "../../doors/read";
import { run } from "../../doors/run";
import { createHeadless, stepFrames } from "../../headless";
import {
  cheatsSource,
  graphSource,
  historySource,
  positionSource,
  taintedSource
} from "../../inspect";

// ---------------------------------------------------------------------------
// Integration: the doors over the real time, model and flow plugins
// ---------------------------------------------------------------------------

type Player = { coins: number };
type Session = { taps: number };

const { defineNode, defineFlow } = defineGame<{
  player: Player;
  session: Session;
  assets: string;
  strings: Record<string, unknown>;
}>();

const awaitIntent = defineNode({
  outcomes: { tap: type(), leave: type() },
  rest: true
});

const tapped = defineNode({
  outcomes: { done: type() },
  run: ({ player, session, out }) => {
    player.coins += 1;
    session.taps += 1;
    return out.done();
  }
});

const board = defineFlow("board", {
  nodes: { awaitIntent, tapped },
  start: "awaitIntent",
  outcomes: { left: type() },
  edges: { awaitIntent: { tap: "tapped", leave: exit("left") }, tapped: { done: "awaitIntent" } }
});

const home = defineNode({ outcomes: { play: type() }, rest: true, checkpoint: true });

const main = defineFlow("main", {
  nodes: { home, board },
  start: "home",
  edges: { home: { play: "board" }, board: { left: "home" } }
});

const createDoorsGame = () =>
  createApp({
    pluginConfigs: {
      model: {
        playerProvider: memory(),
        seed: 7,
        initialPlayer: { coins: 0 },
        initialSession: { taps: 0 }
      },
      clock: { source: fakeClock(1000) },
      flow: { mainFlow: main }
    }
  });

const sources = [graphSource, positionSource, historySource, taintedSource, cheatsSource];

/** Reads every flow source once, the way an editor panel list does. */
const readAll = (app: Parameters<typeof graphSource.read>[0]): unknown[] => [
  read(app, graphSource),
  read(app, positionSource),
  read(app, historySource),
  read(app, taintedSource),
  read(app, cheatsSource)
];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("doors over a real app", () => {
  it("reads the flow sources without changing the game", async () => {
    const app = createDoorsGame();
    const game = await createHeadless(app);
    const state = app.flow.state();
    const snapshot = app.model.store.snapshot();

    expect(read(app, positionSource)).toEqual({
      path: "home",
      flow: "main",
      node: "home",
      waiting: ["play"]
    });
    expect(read(app, graphSource).flows.board?.start).toBe("awaitIntent");

    expect(readAll(app)).toHaveLength(sources.length);

    expect(app.flow.state()).toBe(state);
    expect(app.model.store.snapshot()).toBe(snapshot);
    await game.stop();
  });

  it("keeps state() and snapshot() the same objects while frames pass without a change", async () => {
    const app = createDoorsGame();
    const game = await createHeadless(app);
    const state = app.flow.state();
    const snapshot = app.model.store.snapshot();

    stepFrames(app, 5, 16);

    expect(app.flow.state()).toBe(state);
    expect(app.model.store.snapshot()).toBe(snapshot);
    await game.stop();
  });

  it("watches the position: once on the first frame, then only after an edge", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const app = createDoorsGame();
    const game = await createHeadless(app);
    const seen: string[] = [];
    const stop = watch(app, positionSource, undefined, position => seen.push(position.path));

    stepFrames(app, 3, 16);

    expect(seen).toEqual(["home"]);

    await run(app, walkCommand, { route: [{ at: "home", intent: "play" }] });
    stepFrames(app, 3, 16);

    expect(seen).toEqual(["home", "board/awaitIntent"]);

    stop();
    await game.stop();
  });

  it("walks, answers and bookmarks through the graph with a clean session", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const app = createDoorsGame();
    const game = await createHeadless(app);

    const walked = await run(app, walkCommand, {
      route: [
        { at: "home", intent: "play" },
        { at: "board/awaitIntent", intent: "tap" }
      ]
    });

    expect(walked.state).toMatchObject({ path: "board/awaitIntent", tainted: false });
    expect(walked.value).toBe(app.flow.state());
    expect(app.model.store.snapshot().player).toEqual({ coins: 1 });
    expect(read(app, historySource, { last: 1 })[0]).toMatchObject({ outcome: "done" });

    const answered = await run(app, answerCommand, { intent: "leave" });

    expect(answered.value).toBe(true);

    const bookmark = await run(app, bookmarkCommand);

    expect(bookmark.value.player).toEqual({ coins: 1 });
    expect(bookmark.state.tainted).toBe(false);
    await game.stop();
  });

  it("restores a repro: the bookmark of its state, then its route; the session is tainted", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const app = createDoorsGame();
    const game = await createHeadless(app);
    const repro = {
      player: { coins: 5 },
      session: { taps: 2 },
      checkpoint: "home",
      route: [
        { at: "home", intent: "play" },
        { at: "board/awaitIntent", intent: "tap" }
      ]
    };

    const ran = await run(app, restoreCommand, { repro });

    expect(ran.value.path).toBe("board/awaitIntent");
    expect(ran.state).toMatchObject({ path: "board/awaitIntent", tainted: true });
    expect(app.model.store.snapshot().player).toEqual({ coins: 6 });
    expect(app.model.store.snapshot().session).toEqual({ taps: 3 });
    expect(read(app, taintedSource)).toBe(true);
    expect(read(app, cheatsSource).map(entry => entry.id)).toEqual(["game.restore"]);
    await game.stop();
  });

  it("restores a bookmark taken by game.bookmark", async () => {
    vi.stubGlobal("__MOKU_GAME_DEV__", true);
    const app = createDoorsGame();
    const game = await createHeadless(app);
    const taken = await run(app, bookmarkCommand);

    await run(app, walkCommand, { route: [{ at: "home", intent: "play" }] });
    const ran = await run(app, restoreCommand, {
      bookmark: structuredClone(taken.value)
    });

    expect(ran.state).toMatchObject({ path: "home", tainted: true });
    await game.stop();
  });

  it("refuses every command without the dev flag, and nothing moves", async () => {
    const app = createDoorsGame();
    const game = await createHeadless(app);

    await expect(run(app, answerCommand, { intent: "play" })).rejects.toThrow(
      "[game] Control commands run in dev builds only."
    );
    expect(app.flow.state().path).toBe("home");
    await game.stop();
  });
});
