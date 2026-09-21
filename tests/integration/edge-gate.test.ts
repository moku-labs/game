/**
 * @file Root integration — the gate as the single entry of player answers: the first answer of a
 * double tap wins, an intent the node does not take is refused, and a `guide` narrows the gate
 * only while its node runs.
 */
import { guide, type } from "@moku-labs/game";
import { describe, expect, it } from "vitest";
import { createGame, defineFlow, defineNode, tick } from "./helpers";

const home = defineNode({
  outcomes: { play: type(), shop: type() },
  rest: true,
  checkpoint: true
});

const guided = defineNode({
  outcomes: { closed: type() },
  run: async ({ fx, session, out }) => {
    await fx(guide({ allow: { intent: "ok" }, hand: "tap", text: "Only this one" }));
    await fx({ kind: "popup", answers: ["ok", "cancel"] });

    session.popups += 1;

    return out.closed();
  }
});

const main = defineFlow("main", {
  nodes: { home, guided },
  start: "home",
  edges: { home: { play: "guided", shop: "guided" }, guided: { closed: "home" } }
});

/** Starts the app and its loop in live mode, the way a shipped game does. */
const startGame = async (): Promise<ReturnType<typeof createGame>> => {
  const game = createGame({ mainFlow: main });

  await game.app.start();
  game.app.flow.run().catch(() => undefined);
  await tick();

  return game;
};

describe("the gate", () => {
  it("takes the first answer of a double tap and refuses the second", async () => {
    const { app } = await startGame();

    expect(app.flow.gate.state().allowed).toEqual(["play", "shop"]);
    expect(app.flow.gate.answer({ intent: "play" })).toBe(true);
    // The gate closes before the answer is handed on, so the second tap hits a closed door.
    expect(app.flow.gate.answer({ intent: "play" })).toBe(false);

    await tick();

    expect(app.flow.state().path).toBe("guided");
    expect(app.model.store.snapshot().session).toMatchObject({ popups: 0 });

    await app.stop();
  });

  it("refuses an intent the resting node does not allow", async () => {
    const { app } = await startGame();

    expect(app.flow.gate.answer({ intent: "quit" })).toBe(false);

    await tick();

    expect(app.flow.state().path).toBe("home");

    await app.stop();
  });

  it("narrows the gate while a guide runs and lifts it when the node is left", async () => {
    const { app } = await startGame();

    app.flow.gate.answer({ intent: "play" });
    await tick();

    expect(app.flow.gate.state()).toEqual({
      open: true,
      allowed: ["ok", "cancel"],
      narrowed: true
    });
    // The guide names one answer: everything else the popup lists is refused while it runs.
    expect(app.flow.gate.answer({ intent: "cancel" })).toBe(false);
    expect(app.flow.gate.answer({ intent: "ok" })).toBe(true);

    await tick();

    expect(app.flow.state().path).toBe("home");
    expect(app.flow.gate.state()).toEqual({
      open: true,
      allowed: ["play", "shop"],
      narrowed: false
    });
    expect(app.model.store.snapshot().session).toMatchObject({ popups: 1 });

    await app.stop();
  });
});
