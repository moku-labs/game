/**
 * @file The V1 exit criterion: the fixture merge game of `tests/integration/merge-game/`, written
 * with the engine's public API only, played to the end headless.
 */

import type { Flow } from "@moku-labs/game";
import { createHeadless, runRepro } from "@moku-labs/game/testing";
import { describe, expect, it } from "vitest";
import { createGame, startMoment } from "./merge-game/game";
import { startingPlayer, startingSession } from "./merge-game/state";
import { generatorId, tables } from "./merge-game/tables";

/** Yields the microtask queue to the loop, the way a test waits without a timer. */
const tick = async (times = 60): Promise<void> => {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
};

/** One tap on the only generator of the game. */
const tap: Flow.RouteStep = { at: "board/awaitIntent", intent: "tap", payload: { generatorId } };

/** Drag the item on `from` onto the item on `to`. */
const mergeStep = (from: string, to: string): Flow.RouteStep => ({
  at: "board/awaitIntent",
  intent: "merge",
  payload: { from, to }
});

/** Open the board, spend the generator's four charges, merge them up to one level-3 item, give it. */
const untilOrder: Flow.RouteStep[] = [
  { at: "home", intent: "play" },
  tap,
  tap,
  tap,
  tap,
  mergeStep("c0_0", "c1_0"),
  mergeStep("c0_1", "c1_1"),
  mergeStep("c1_0", "c1_1"),
  { at: "board/awaitIntent", intent: "give", payload: { item: "i4", order: 0 } }
];

/** The reward popup the finished order opened. */
const claim: Flow.RouteStep = { at: "afterOrder/show", intent: "claim" };

/** The journal as a list of readable edges, for an assertion that reads like the game. */
const edgesOf = (entries: readonly { path: string; outcome: string }[]): string[] =>
  entries.map(entry => `${entry.path} -${entry.outcome}->`);

describe("template-merge", () => {
  it("treats the reward popup, a rest node entered through a slot, as a rest point", async () => {
    const { app, provider } = createGame();
    const game = await createHeadless(app);

    await game.walk([{ at: "home", intent: "play" }]);

    const commitsOnTheBoard = provider.calls.filter(call => call.method === "commit").length;

    await game.walk(untilOrder.slice(1));

    expect(game.state().path).toBe("afterOrder/show");
    expect(app.flow.bookmark().path).toBe("afterOrder/show");
    expect(provider.calls.filter(call => call.method === "commit").length).toBeGreaterThan(
      commitsOnTheBoard
    );
    expect(provider.calls.at(-1)?.method).toBe("commit");

    await game.stop();
  });

  it("restores a bookmark taken on the reward popup back onto the popup", async () => {
    const { app } = createGame();
    const game = await createHeadless(app);

    await game.walk(untilOrder);

    const bookmark = app.flow.bookmark();

    await game.walk([claim]);
    await app.flow.restore(bookmark);
    await tick();

    expect(game.state().path).toBe("afterOrder/show");
    expect(app.flow.gate.state().allowed).toContain("claim");

    await game.stop();
  });

  it("plays a whole session from home through the board to the reward popup", async () => {
    const { app } = createGame();
    const game = await createHeadless(app);

    expect(game.state().path).toBe("home");

    const board = await game.walk(untilOrder);

    expect(board.path).toBe("afterOrder/show");
    expect(edgesOf(game.history())).toEqual([
      "home -play->",
      "board/awaitIntent -tap->",
      "board/tapGenerator -done->",
      "board/awaitIntent -tap->",
      "board/tapGenerator -done->",
      "board/awaitIntent -tap->",
      "board/tapGenerator -done->",
      "board/awaitIntent -tap->",
      "board/tapGenerator -done->",
      "board/awaitIntent -merge->",
      "board/merge -done->",
      "board/awaitIntent -merge->",
      "board/merge -done->",
      "board/awaitIntent -merge->",
      "board/merge -done->",
      "board/awaitIntent -give->",
      "board/giveToOrder -orderComplete->"
    ]);
    expect(app.model.store.snapshot().session).toMatchObject({ taps: 4, pendingReward: "planks" });

    const home = await game.walk([claim]);

    expect(home.path).toBe("home");
    // `home` is a checkpoint: the journal is compacted when the graph reaches it.
    expect(game.history()).toEqual([]);
    expect(app.model.store.snapshot().player).toMatchObject({
      claimed: ["planks"],
      merge: {
        board: { items: [] },
        wallet: { coins: 25 },
        energy: { value: tables.energy.max - 4 },
        generators: { sawmill: { charges: 0 } },
        orders: [{ id: 2, given: [] }, { id: 1 }],
        nextItemId: 5
      }
    });
    expect(app.model.store.snapshot().session).toMatchObject({ pendingReward: "" });

    await game.stop();
  });

  it("keeps the state and the game after an illegal merge", async () => {
    const { app } = createGame();
    const game = await createHeadless(app);

    await game.walk([{ at: "home", intent: "play" }, tap, tap]);

    const before = app.model.store.snapshot().player;

    await game.walk([mergeStep("c0_0", "c2_2")]);

    expect(app.model.store.snapshot().player).toEqual(before);
    expect(game.state().path).toBe("board/awaitIntent");
    expect(game.history().slice(-1)).toMatchObject([
      { outcome: "rejected", payload: { reason: "empty" } }
    ]);

    await game.walk([mergeStep("c0_0", "c1_0")]);

    expect(app.model.store.snapshot().player).toMatchObject({
      merge: { board: { items: [{ id: "i2", level: 2, cell: "c1_0" }] } }
    });

    await game.stop();
  });

  it("delivers the generator's own due moment to the resting board", async () => {
    const { app, clock } = createGame();
    const game = await createHeadless(app);

    await game.walk([{ at: "home", intent: "play" }, tap, tap, tap, tap]);

    expect(app.model.store.snapshot().player).toMatchObject({
      merge: { generators: { sawmill: { charges: 0, readyAt: startMoment + 60_000 } } }
    });

    clock.advance(60_000);
    await tick();

    expect(game.state().path).toBe("board/awaitIntent");
    expect(edgesOf(game.history())).toContain("board/awaitIntent -elapsed->");
    expect(app.model.store.snapshot().player).toMatchObject({
      merge: { generators: { sawmill: { charges: tables.generators.sawmill.maxCharges } } }
    });

    await game.walk([tap]);

    expect(app.model.store.snapshot().session).toMatchObject({ taps: 5 });

    await game.stop();
  });

  it("gives the same player state and the same journal for one route played twice", async () => {
    const first = createGame({ seed: 7 });
    const firstGame = await createHeadless(first.app);

    await firstGame.walk(untilOrder);

    const firstPlayer = first.app.model.store.snapshot().player;
    const firstJournal = firstGame.history();

    await firstGame.stop();

    const second = createGame({ seed: 7 });
    const secondGame = await createHeadless(second.app);

    await secondGame.walk(untilOrder);

    expect(second.app.model.store.snapshot().player).toEqual(firstPlayer);
    expect(secondGame.history()).toEqual(firstJournal);

    await secondGame.stop();
  });

  it("starts the next app from the save the first one wrote", async () => {
    const first = createGame();
    const firstGame = await createHeadless(first.app);

    await firstGame.walk([...untilOrder, claim]);

    const saved = first.app.model.store.snapshot().player;

    await firstGame.stop();

    const methods = first.provider.calls.map(call => call.method);

    expect(methods[0]).toBe("load");
    expect(methods).toContain("commit");
    expect(methods.at(-1)).toBe("flush");

    // The same provider instance: the second app reads exactly what the first one wrote into it.
    const second = createGame({ provider: first.provider });
    const secondGame = await createHeadless(second.app);

    expect(secondGame.state().path).toBe("home");
    expect(second.app.model.store.snapshot().player).toEqual(saved);

    await secondGame.stop();
  });

  it("replays a repro from the home checkpoint", async () => {
    const { app } = createGame();

    const result = await runRepro(app, {
      player: startingPlayer,
      session: startingSession,
      checkpoint: "home",
      route: [{ at: "home", intent: "play" }, tap, tap]
    });

    expect(result.path).toEqual(["board", "awaitIntent"]);
    expect(result.player).toMatchObject({ merge: { nextItemId: 3, energy: { value: 8 } } });

    await app.stop();
  });
});
