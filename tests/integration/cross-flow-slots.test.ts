/**
 * @file Framework-level scenarios of slots: a slot nested inside a contribution, and the `when` of a
 * later contribution reading what an earlier one committed.
 */
import type { Model } from "@moku-labs/game";
import { exit, slot, type } from "@moku-labs/game";
import { createHeadless } from "@moku-labs/game/testing";
import { describe, expect, it } from "vitest";
import { createEdgeLog, createGame, defineFeature, defineFlow, defineNode, tick } from "./helpers";

/** Reads the coins of a committed player tree, which `when` receives as plain JSON. */
const coinsOf = (player: Model.Json): number => {
  if (typeof player !== "object" || player === null || Array.isArray(player)) return 0;

  return typeof player.coins === "number" ? player.coins : 0;
};

const home = defineNode({ outcomes: { play: type() }, rest: true, checkpoint: true });

const main = defineFlow("main", {
  nodes: { home, after: slot("after") },
  start: "home",
  edges: { home: { play: "after" }, after: { done: "home" } }
});

describe("slots", () => {
  it("enters a slot that sits inside a contribution of another slot", async () => {
    const bonus = defineNode({ outcomes: { ok: type() }, rest: true });
    const innerFlow = defineFlow("inner", {
      nodes: { bonus },
      start: "bonus",
      outcomes: { done: type() },
      edges: { bonus: { ok: exit("done") } }
    });
    const show = defineNode({ outcomes: { claim: type() }, rest: true });
    const outerFlow = defineFlow("outer", {
      nodes: { show, extra: slot("extra") },
      start: "show",
      outcomes: { done: type() },
      edges: { show: { claim: "extra" }, extra: { done: exit("done") } }
    });
    const outerFeature = defineFeature("outerFeature", {
      flows: [outerFlow],
      contribute: { after: { flow: outerFlow, order: 10 } }
    });
    const innerFeature = defineFeature("innerFeature", {
      flows: [innerFlow],
      contribute: { extra: { flow: innerFlow, order: 10 } }
    });
    const { app } = createGame({ mainFlow: main, plugins: [outerFeature, innerFeature] });
    const game = await createHeadless(app);

    const state = await game.walk([
      { at: "home", intent: "play" },
      { at: "after/show", intent: "claim" }
    ]);

    expect(state.path).toBe("after/extra/bonus");
    expect(Object.keys(app.flow.describe().flows)).toContain("inner");

    const back = await game.walk([{ at: "after/extra/bonus", intent: "ok" }]);

    expect(back.path).toBe("home");
    await game.stop();
  });

  it("picks a later contribution by the state the earlier one committed", async () => {
    const earn = defineNode({
      outcomes: { done: type() },
      run: ({ player, out }) => {
        player.coins = 5;

        return out.done();
      }
    });
    const earnFlow = defineFlow("earn", {
      nodes: { earn },
      start: "earn",
      outcomes: { done: type() },
      edges: { earn: { done: exit("done") } }
    });
    const rich = defineNode({ outcomes: { ok: type() }, rest: true });
    const richFlow = defineFlow("rich", {
      nodes: { rich },
      start: "rich",
      outcomes: { done: type() },
      edges: { rich: { ok: exit("done") } }
    });
    const earnFeature = defineFeature("earnFeature", {
      flows: [earnFlow],
      contribute: { after: { flow: earnFlow, order: 10 } }
    });
    const richFeature = defineFeature("richFeature", {
      flows: [richFlow],
      contribute: {
        after: { flow: richFlow, order: 20, when: ({ player }) => coinsOf(player) >= 5 }
      }
    });
    const log = createEdgeLog();
    const { app } = createGame({ mainFlow: main, plugins: [earnFeature, richFeature, log.plugin] });
    const game = await createHeadless(app);

    const state = await game.walk([{ at: "home", intent: "play" }]);

    expect(state.path).toBe("after/rich");

    const back = await game.walk([{ at: "after/rich", intent: "ok" }]);

    await tick();

    // The slot closes with its own `done` edge, after the last contribution ended.
    expect(back.path).toBe("home");
    expect(log.edges).toEqual(["play", "done", "ok", "done"]);
    await game.stop();
  });
});
