/**
 * @file Root integration — the save journey: play, stop, start again from the written document,
 * migrate an older save and refuse one this build cannot read.
 */
import type { Model } from "@moku-labs/game";
import { SaveUnreadableError, type } from "@moku-labs/game";
import { createHeadless, memory, saveOf } from "@moku-labs/game/testing";
import { describe, expect, it } from "vitest";
import { createGame, defineFlow, defineNode, tick } from "./helpers";

const home = defineNode({ outcomes: { play: type() }, rest: true, checkpoint: true });

const earn = defineNode({
  outcomes: { done: type() },
  run: ({ player, out }) => {
    player.coins += 3;
    player.visits += 1;

    return out.done();
  }
});

/** A rest node that is not a checkpoint: a bookmark of it is only accepted by the same graph. */
const shop = defineNode({ outcomes: { leave: type() }, rest: true });

const main = defineFlow("main", {
  nodes: { home, earn, shop },
  start: "home",
  edges: { home: { play: "earn" }, earn: { done: "shop" }, shop: { leave: "home" } }
});

/** The migration of save version 1: it gives the player the `visits` counter of version 2. */
const addVisits = (state: Model.Json): Model.Json => {
  if (typeof state !== "object" || state === null || Array.isArray(state)) return state;

  const player = state.player;

  if (typeof player !== "object" || player === null || Array.isArray(player)) return state;

  return { ...state, player: { ...player, visits: 1 } };
};

describe("the save journey", () => {
  it("starts a second app from the document the first one wrote", async () => {
    const first = createGame({ mainFlow: main });
    const firstGame = await createHeadless(first.app);

    await firstGame.walk([{ at: "home", intent: "play" }]);

    expect(firstGame.state().path).toBe("shop");

    const bookmark = first.app.flow.bookmark();
    const saved = first.app.model.store.snapshot().player;

    await firstGame.stop();

    expect(first.provider.calls.at(-1)?.method).toBe("flush");

    const second = createGame({
      mainFlow: main,
      provider: memory({ state: saveOf(saved), version: 1 })
    });
    const secondGame = await createHeadless(second.app);

    await tick();

    expect(secondGame.state().path).toBe("home");
    expect(second.app.model.store.snapshot().player).toEqual(saved);

    await second.app.flow.restore(bookmark);

    expect(secondGame.state().path).toBe("shop");
    expect(second.app.model.store.snapshot().player).toMatchObject({ coins: 3, visits: 1 });

    await secondGame.stop();
  });

  it("migrates a save written by an older schema version", async () => {
    const provider = memory({ state: saveOf({ coins: 7, draws: [] }), version: 1 });
    const { app } = createGame({
      mainFlow: main,
      provider,
      schemaVersion: 2,
      migrations: [{ from: 1, up: addVisits }]
    });
    const game = await createHeadless(app);

    await tick();

    expect(app.model.store.snapshot().player).toEqual({ coins: 7, visits: 1, draws: [] });

    await game.walk([{ at: "home", intent: "play" }]);

    // A migrated save has no base on the provider's side: it receives the whole document.
    expect(provider.calls.at(-1)).toMatchObject({ method: "commit", version: 2 });

    await game.stop();
  });

  it("refuses to run on a save this build cannot read", async () => {
    const provider = memory({ state: saveOf({ coins: 1, visits: 0, draws: [] }), version: 3 });
    const { app } = createGame({ mainFlow: main, provider, schemaVersion: 1 });

    await app.start();

    const failure = await app.flow.run().catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(SaveUnreadableError);
    expect(failure).toMatchObject({ savedVersion: 3, schemaVersion: 1 });

    await app.stop();
  });
});
