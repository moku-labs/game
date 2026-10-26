/**
 * @file Framework-level scenarios of slots: a slot nested inside a contribution, the `when` of a
 * later contribution reading what an earlier one committed, and a contribution that hands the
 * player back to the main flow on a named outcome of its slot.
 */
import type { Model } from "@moku-labs/game";
import { contribution, exit, slot, to, type } from "@moku-labs/game";
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

  // Bug: a named exit of a contribution never reaches the main flow, or the slot resumes after it.
  it("hands the player to a sheet of the main flow on a named outcome, and back to the first contribution", async () => {
    const episodeStep = slot("episodeStep", { shop: type<{ tab: string }>() });
    const shopSheet = defineNode({
      rest: true,
      input: type<{ tab: string; from: string }>(),
      outcomes: { back: type() }
    });
    const episodeMain = defineFlow("main", {
      nodes: { home, episodeStep, shopSheet },
      start: "home",
      edges: {
        home: { play: "episodeStep" },
        episodeStep: {
          done: "home",
          shop: to("shopSheet", (handBack: { tab: string }) => ({ ...handBack, from: "story" }))
        },
        shopSheet: { back: "episodeStep" }
      }
    });
    const panorama = defineNode({
      rest: true,
      outcomes: { next: type(), shop: type<{ tab: string }>() }
    });
    const storyFlow = defineFlow("story", {
      nodes: { panorama },
      start: "panorama",
      outcomes: { done: type(), shop: type<{ tab: string }>() },
      edges: { panorama: { next: exit("done"), shop: exit("shop") } }
    });
    const bonus = defineNode({ rest: true, outcomes: { ok: type() } });
    const bonusFlow = defineFlow("bonus", {
      nodes: { bonus },
      start: "bonus",
      outcomes: { done: type() },
      edges: { bonus: { ok: exit("done") } }
    });
    const storyFeature = defineFeature("storyFeature", {
      flows: [storyFlow],
      contribute: { ...contribution(episodeStep, { flow: storyFlow, order: 10 }) }
    });
    const bonusFeature = defineFeature("bonusFeature", {
      flows: [bonusFlow],
      contribute: { ...contribution(episodeStep, { flow: bonusFlow, order: 20, when: () => true }) }
    });
    const log = createEdgeLog();
    const { app } = createGame({
      mainFlow: episodeMain,
      plugins: [storyFeature, bonusFeature, log.plugin]
    });
    const game = await createHeadless(app);

    await game.walk([{ at: "home", intent: "play" }]);
    const sheet = await game.walk([
      { at: "episodeStep/panorama", intent: "shop", payload: { tab: "gems" } }
    ]);

    await tick();

    // The story left the slot at once: the bonus did not run, and the slot took its own edge.
    expect(sheet.path).toBe("shopSheet");
    expect(sheet.stack.at(-1)?.input).toEqual({ tab: "gems", from: "story" });
    expect(log.edges).toEqual(["play", "shop", "shop"]);
    expect(app.flow.describe().flows.main?.nodes.episodeStep?.outcomes).toEqual(["done", "shop"]);

    const again = await game.walk([{ at: "shopSheet", intent: "back" }]);

    // Back in the slot, it starts at its first contribution again.
    expect(again.path).toBe("episodeStep/panorama");
    await game.stop();
  });
});
