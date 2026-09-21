/**
 * @file Root integration — flow against model: state commits on the edge, a failure rolls back,
 * a barrier makes the save durable and the rng draws are deterministic.
 */
import type { Flow, Model } from "@moku-labs/game";
import { createPlugin, flowPlugin, type } from "@moku-labs/game";
import { createHeadless } from "@moku-labs/game/testing";
import { describe, expect, it } from "vitest";
import { createGame, defineFlow, defineNode, tick } from "./helpers";

// ─── the flow that fails ──────────────────────────────────────

const home = defineNode({ outcomes: { play: type(), boom: type() }, rest: true, checkpoint: true });

const explode = defineNode({
  outcomes: { done: type() },
  run: ({ player }) => {
    // The change happens before the throw: only a committed edge may keep it.
    player.coins += 10;

    throw new Error("the node broke");
  }
});

const safe = defineNode({ outcomes: { back: type() }, rest: true, checkpoint: true });

const failing = defineFlow("failing", {
  nodes: { home, explode, safe },
  start: "home",
  edges: {
    home: { play: "safe", boom: "explode" },
    explode: { done: "home" },
    safe: { back: "home" }
  }
});

// ─── the flow that saves and draws ────────────────────────────

const bankHome = defineNode({
  outcomes: { save: type(), draw: type() },
  rest: true,
  checkpoint: true
});

const persist = defineNode({
  outcomes: { done: type() },
  barrier: true,
  run: ({ player, out }) => {
    player.coins += 5;

    return out.done();
  }
});

const draw = defineNode({
  outcomes: { done: type() },
  run: ({ player, rng, out }) => {
    const chest = rng.stream("chest");
    const crate = rng.stream("crate");

    player.draws = [chest.int(1000), chest.int(1000), crate.int(1000), crate.int(1000)];

    return out.done();
  }
});

const bank = defineFlow("bank", {
  nodes: { home: bankHome, persist, draw },
  start: "home",
  edges: {
    home: { save: "persist", draw: "draw" },
    persist: { done: "home" },
    draw: { done: "home" }
  }
});

/** A plugin that records every `flow:error` the runner emits. Its type is inferred from the spec. */
const createErrorLog = () => {
  const errors: Flow.Events["flow:error"][] = [];
  const plugin = createPlugin("errorLog", {
    depends: [flowPlugin],
    hooks: () => ({
      "flow:error": (payload: Flow.Events["flow:error"]) => {
        errors.push(payload);
      }
    })
  });

  return { plugin, errors };
};

/** Reads the drawn numbers out of a committed player tree. */
const drawsOf = (player: Model.Json): number[] => {
  if (typeof player !== "object" || player === null || Array.isArray(player)) return [];

  const draws = player.draws;

  if (!Array.isArray(draws)) return [];

  return draws.filter((value): value is number => typeof value === "number");
};

describe("flow against model", () => {
  it("keeps the player unchanged when a node throws and returns to the rest node", async () => {
    const log = createErrorLog();
    const { app } = createGame({ mainFlow: failing, plugins: [log.plugin], retries: 1 });
    const game = await createHeadless(app);

    const state = await game.walk([{ at: "home", intent: "boom" }]);
    await tick();

    expect(state.path).toBe("home");
    expect(app.model.store.snapshot().player).toMatchObject({ coins: 0 });
    expect(log.errors).toHaveLength(1);
    expect(log.errors[0]).toMatchObject({ path: "explode", rolledBackTo: "home", retry: true });

    await game.stop();
  });

  it("enters the safe node once the retries are used up", async () => {
    const log = createErrorLog();
    const { app } = createGame({
      mainFlow: failing,
      plugins: [log.plugin],
      retries: 0,
      safeNode: "safe"
    });
    const game = await createHeadless(app);

    const state = await game.walk([{ at: "home", intent: "boom" }]);
    await tick();

    expect(state.path).toBe("safe");
    expect(log.errors[0]).toMatchObject({ rolledBackTo: "safe", retry: false });
    expect(app.model.store.snapshot().player).toMatchObject({ coins: 0 });

    await game.stop();
  });

  it("commits durably when the graph leaves a barrier node", async () => {
    const { app, provider } = createGame({ mainFlow: bank });
    const game = await createHeadless(app);

    await game.walk([{ at: "home", intent: "save" }]);

    expect(app.model.store.snapshot().player).toMatchObject({ coins: 5 });
    expect(provider.calls.map(call => call.method)).toEqual(["load", "commitDurable"]);
    expect(provider.calls.at(-1)).toMatchObject({ txId: expect.stringContaining("persist#") });

    await game.stop();
  });

  it("draws the same numbers for one seed and different ones per stream", async () => {
    const first = createGame({ mainFlow: bank, seed: 11 });
    const firstGame = await createHeadless(first.app);

    await firstGame.walk([{ at: "home", intent: "draw" }]);

    const draws = drawsOf(first.app.model.store.snapshot().player);

    await firstGame.stop();

    const second = createGame({ mainFlow: bank, seed: 11 });
    const secondGame = await createHeadless(second.app);

    await secondGame.walk([{ at: "home", intent: "draw" }]);

    expect(drawsOf(second.app.model.store.snapshot().player)).toEqual(draws);
    // Two streams of one seed are independent: the same two draws twice would be a shared stream.
    expect(draws.slice(0, 2)).not.toEqual(draws.slice(2));

    await secondGame.stop();
  });
});
