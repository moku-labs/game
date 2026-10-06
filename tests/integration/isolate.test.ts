import type { AnyPluginInstance } from "@moku-labs/core";
import { createPlugin, defineGame, exit, flowPlugin, type } from "@moku-labs/game";
import { createHeadless, fakeClock, isolate, stub } from "@moku-labs/game/testing";
import { describe, expect, it } from "vitest";
import { homeFeature } from "../fixtures/mini-game/features/home";
import { infoFeature } from "../fixtures/mini-game/features/info";
import { infoFlow } from "../fixtures/mini-game/flows/info";
import { mainFlow } from "../fixtures/mini-game/flows/main";
import { startingPlayer, startingSession } from "../fixtures/mini-game/state";

// ---------------------------------------------------------------------------
// Integration: one feature played headless without the rest of the game. `isolate` composes the
// feature as `logicOnly`, puts its flow into a harness main flow and replaces the stubbed nodes;
// `createHeadless` plays it. First on the mini game, then on a board feature written here in the
// shape of merge-game's `flows/board.ts`.
// ---------------------------------------------------------------------------

/**
 * A plugin that writes down every edge, `node:outcome>next`. A checkpoint compacts `history()`,
 * so a test that passes a checkpoint reads the edges here.
 *
 * @returns The plugin and the edges it saw.
 */
function edgeLog(): { plugin: AnyPluginInstance; edges: string[] } {
  const edges: string[] = [];
  const plugin = createPlugin("edgeLog", {
    depends: [flowPlugin],
    hooks: () => ({
      "flow:edge": ({ node, outcome, next }) => {
        edges.push(`${node}:${outcome}>${next}`);
      }
    })
  });

  return { plugin, edges };
}

describe("isolate on the mini game", () => {
  it("rests on Home inside the harness; the stubbed popup ends with ok and count never runs", async () => {
    const log = edgeLog();
    const homeOnly = isolate(homeFeature, {
      flow: mainFlow,
      stubs: { info: stub("ok") },
      plugins: [log.plugin],
      player: startingPlayer,
      session: startingSession
    });
    const app = homeOnly();
    const game = await createHeadless(app);

    expect(game.state().path).toBe("main/home");

    const state = await game.walk([{ at: "main/home", intent: "info" }]);

    expect(state.path).toBe("main/home");
    expect(log.edges).toEqual(["home:info>main/info/end", "end:ok>main/home"]);
    expect(app.flow.bookmark().player).toEqual({ count: 0 });
    expect(app.flow.bookmark().session).toEqual({ opened: 0 });
    await game.stop();
  });

  it("lets a route substitute the stub for one visit", async () => {
    const log = edgeLog();
    const homeOnly = isolate(homeFeature, {
      flow: mainFlow,
      stubs: { info: stub("ok") },
      plugins: [log.plugin],
      player: startingPlayer
    });
    const game = await createHeadless(homeOnly());

    await game.walk([
      { at: "main/home", intent: "info" },
      { at: "main/info", result: { outcome: "close" } }
    ]);

    expect(log.edges).toEqual(["home:info>main/info", "info:close>main/home"]);
    await game.walk([{ at: "main/home", intent: "info" }]);
    expect(log.edges.slice(2)).toEqual(["home:info>main/info/end", "end:ok>main/home"]);
    await game.stop();
  });

  it("runs the real popup when it is not stubbed, although its feature is not composed", async () => {
    const homeOnly = isolate(homeFeature, { flow: mainFlow, player: startingPlayer });
    const app = homeOnly({ session: { opened: 4 } });
    const game = await createHeadless(app);

    await game.walk([{ at: "main/home", intent: "info" }]);
    expect(game.state().path).toBe("main/info/show");

    await game.walk([{ at: "main/info/show", intent: "ok" }]);
    expect(game.state().path).toBe("main/home");
    expect(app.flow.bookmark().player).toEqual({ count: 1 });
    expect(app.flow.bookmark().session).toEqual({ opened: 5 });
    expect(app.flow.features.all().map(feature => feature.name)).toEqual(["home"]);
    await game.stop();
  });

  it("describes the harness, the main flow and the stub, and no exited node for main", async () => {
    const homeOnly = isolate(homeFeature, {
      flow: mainFlow,
      stubs: { info: stub("ok") },
      player: startingPlayer
    });
    const app = homeOnly();
    const game = await createHeadless(app);
    const graph = app.flow.describe();

    expect(Object.keys(graph.flows)).toEqual(["isolated", "main", "stub:info"]);
    expect(graph.main).toBe("isolated");
    expect(Object.keys(graph.flows.isolated?.nodes ?? {})).toEqual(["main"]);
    await game.stop();
  });

  it("names the harness node by as: the popup flow held as info reads info/show, as in the game", async () => {
    const infoOnly = isolate(infoFeature, {
      flow: infoFlow,
      as: "info",
      player: startingPlayer,
      session: startingSession
    });
    const game = await createHeadless(infoOnly());

    expect(game.state().path).toBe("info/show");
    await game.walk([{ at: "info/show", intent: "close" }]);
    expect(game.state().path).toBe("exited");
    await game.stop();
  });

  it("lands an exit of the isolated flow on exited; again enters the flow once more", async () => {
    const infoOnly = isolate(infoFeature, {
      flow: infoFlow,
      player: { count: 2 },
      session: startingSession
    });
    const app = infoOnly();
    const game = await createHeadless(app);

    expect(game.state().path).toBe("infoPopup/show");

    await game.walk([{ at: "infoPopup/show", intent: "close" }]);
    expect(game.state().path).toBe("exited");
    expect(game.history().at(-1)).toMatchObject({
      path: "infoPopup/show",
      outcome: "close",
      next: "exited"
    });

    await game.walk([{ at: "exited", intent: "again" }]);
    expect(game.state().path).toBe("infoPopup/show");

    await game.walk([{ at: "infoPopup/show", intent: "ok" }]);
    expect(game.state().path).toBe("exited");
    expect(game.history().at(-1)).toMatchObject({ path: "infoPopup/count", outcome: "done" });
    expect(app.flow.bookmark().player).toEqual({ count: 3 });
    await game.stop();
  });
});

// ─── A board feature in the shape of merge-game's flows/board.ts ─────

type Player = { energy: number; coins: number; opened: number };
type Session = { lastToast?: string };

const { defineNode, defineFlow, defineFeature } = defineGame<{
  player: Player;
  session: Session;
  assets: string;
  strings: Record<string, never>;
}>();

// The settings feature, another feature the board reaches into by object.
const enter = defineNode({
  outcomes: { done: type() },
  run: ({ player, out }) => {
    player.opened += 1;

    return out.done();
  }
});
const open = defineNode({ rest: true, outcomes: { close: type() } });
const settingsFlow = defineFlow("settingsPopup", {
  nodes: { enter, open },
  start: "enter",
  outcomes: { closed: type() },
  edges: { enter: { done: "open" }, open: { close: exit("closed") } }
});

// The shared layer: a node every feature may hold.
const toast = defineNode({
  input: type<{ text: string }>(),
  outcomes: { done: type() },
  run: ({ input, session, out }) => {
    session.lastToast = input.text;

    return out.done();
  }
});
const sharedLayer = defineFeature("shared", { nodes: [toast] });

const awaitIntent = defineNode({
  rest: true,
  checkpoint: true,
  outcomes: { tap: type(), give: type(), openSettings: type(), leave: type() }
});
const tapGenerator = defineNode({
  outcomes: { done: type(), noEnergy: type(), boardFull: type<{ text: string }>() },
  run: ({ player, out }) => {
    if (player.energy <= 0) return out.noEnergy();
    if (player.coins >= 100) return out.boardFull({ text: "The board is full" });

    player.energy -= 1;

    return out.done();
  }
});
// A popup node of the energy feature, used by the board as a node: it rests for the player.
const energy = defineNode({ rest: true, over: true, outcomes: { watch: type(), later: type() } });
const giveToOrder = defineNode({
  outcomes: { done: type(), orderComplete: type<{ rewardId: string }>() },
  run: ({ player, out }) => {
    player.coins += 10;

    return out.orderComplete({ rewardId: "real" });
  }
});
const boardFlow = defineFlow("board", {
  nodes: { awaitIntent, tapGenerator, energy, giveToOrder, toast, settings: settingsFlow },
  start: "awaitIntent",
  outcomes: { orderComplete: type<{ rewardId: string }>(), left: type() },
  edges: {
    awaitIntent: {
      tap: "tapGenerator",
      give: "giveToOrder",
      openSettings: "settings",
      leave: exit("left")
    },
    tapGenerator: { done: "awaitIntent", noEnergy: "energy", boardFull: "toast" },
    energy: { watch: "awaitIntent", later: "awaitIntent" },
    giveToOrder: { done: "awaitIntent", orderComplete: exit("orderComplete") },
    toast: { done: "awaitIntent" },
    settings: { closed: "awaitIntent" }
  }
});
// The feature name is not the flow id: a feature and a flow share one namespace.
const boardFeature = defineFeature("boardScreen", { flows: [boardFlow] });

const fresh: Player = { energy: 1, coins: 0, opened: 0 };

describe("isolate on a board feature", () => {
  it("plays the board with other features stubbed: paths read as in the game", async () => {
    const log = edgeLog();
    const boardOnly = isolate(boardFeature, {
      shared: sharedLayer,
      flow: boardFlow,
      stubs: {
        settings: stub("closed"),
        energy: stub("later"),
        giveToOrder: stub("orderComplete", { rewardId: "r1" })
      },
      plugins: [log.plugin],
      player: fresh
    });
    const app = boardOnly({ player: { ...fresh, energy: 0 } });
    const game = await createHeadless(app);

    expect(game.state().path).toBe("board/awaitIntent");
    expect(app.flow.features.all().map(feature => feature.name)).toEqual(["shared", "boardScreen"]);

    // noEnergy leads to the stubbed energy popup, which ends with later.
    await game.walk([{ at: "board/awaitIntent", intent: "tap" }]);
    expect(game.state().path).toBe("board/awaitIntent");
    expect(log.edges).toEqual([
      "awaitIntent:tap>board/tapGenerator",
      "tapGenerator:noEnergy>board/energy/end",
      "end:later>board/awaitIntent"
    ]);

    // The stubbed settings flow ends with closed: its real nodes never run.
    await game.walk([{ at: "board/awaitIntent", intent: "openSettings" }]);
    expect(log.edges.slice(3)).toEqual([
      "awaitIntent:openSettings>board/settings/end",
      "end:closed>board/awaitIntent"
    ]);

    // The stubbed transit node leaves the flow with orderComplete and the stub's payload.
    await game.walk([{ at: "board/awaitIntent", intent: "give" }]);
    expect(game.state().path).toBe("exited");
    expect(game.history().at(-1)).toMatchObject({
      path: "board/giveToOrder/end",
      outcome: "orderComplete",
      payload: { rewardId: "r1" },
      next: "exited"
    });
    expect(app.flow.bookmark().player).toEqual({ energy: 0, coins: 0, opened: 0 });

    // again enters the board once more; leave exits it.
    await game.walk([
      { at: "exited", intent: "again" },
      { at: "board/awaitIntent", intent: "leave" }
    ]);
    expect(game.state().path).toBe("exited");
    expect(game.history().at(-1)).toMatchObject({ path: "board/awaitIntent", outcome: "leave" });
    await game.stop();
  });

  it("runs every node that is not stubbed for real, the shared layer's included", async () => {
    const boardOnly = isolate(boardFeature, {
      shared: sharedLayer,
      flow: boardFlow,
      player: fresh
    });
    const app = boardOnly({ player: { ...fresh, coins: 100 } });
    const game = await createHeadless(app);

    await game.walk([{ at: "board/awaitIntent", intent: "tap" }]);
    expect(app.flow.bookmark().session).toEqual({ lastToast: "The board is full" });

    await game.walk([{ at: "board/awaitIntent", intent: "openSettings" }]);
    expect(game.state().path).toBe("board/settings/open");
    expect(app.flow.bookmark().player).toEqual({ energy: 1, coins: 100, opened: 1 });
    await game.stop();
  });

  it("starts every app from the options, and one app's seams win over them", async () => {
    const boardOnly = isolate(boardFeature, { flow: boardFlow, player: fresh });
    const plain = boardOnly();
    const pinned = boardOnly({
      player: { ...fresh, coins: 7 },
      session: { lastToast: "hi" },
      seed: 9,
      clock: fakeClock(1_000_000)
    });
    const first = await createHeadless(plain);
    const second = await createHeadless(pinned);

    expect(plain.flow.bookmark()).toMatchObject({ player: fresh, session: {}, rng: { seed: 1 } });
    expect(pinned.flow.bookmark()).toMatchObject({
      player: { ...fresh, coins: 7 },
      session: { lastToast: "hi" },
      rng: { seed: 9 }
    });
    expect(pinned.clock.now()).toBe(1_000_000);
    await first.stop();
    await second.stop();
  });

  it("takes the session and the seed of the options", async () => {
    const boardOnly = isolate(boardFeature, {
      flow: boardFlow,
      player: fresh,
      session: { lastToast: "from options" },
      seed: 3
    });
    const app = boardOnly();
    const game = await createHeadless(app);

    expect(app.flow.bookmark()).toMatchObject({
      session: { lastToast: "from options" },
      rng: { seed: 3 }
    });
    await game.stop();
  });

  it("keeps the owner feature in describe() without stubs; a rebuilt flow names none", async () => {
    const whole = isolate(boardFeature, { flow: boardFlow, player: fresh })();
    const stubbed = isolate(boardFeature, {
      flow: boardFlow,
      stubs: { energy: stub("later") },
      player: fresh
    })();
    const first = await createHeadless(whole);
    const second = await createHeadless(stubbed);

    expect(whole.flow.describe().flows.board?.nodes.awaitIntent?.owner).toBe("boardScreen");
    expect(stubbed.flow.describe().flows.board?.nodes.awaitIntent?.owner).toBeUndefined();
    await first.stop();
    await second.stop();
  });
});
