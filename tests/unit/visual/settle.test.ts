import { describe, expect, it } from "vitest";
import type { FlowState } from "../../../src/plugins/flow/types";
import { frames, settle } from "../../../src/visual/settle";
import type { SettleApp } from "../../../src/visual/types";

// ---------------------------------------------------------------------------
// Unit (fake app): settle steps frames until the graph rests at a gate or
// stops, yields a task after every frame, and gives up after the frame cap
// ---------------------------------------------------------------------------

/** A fake game: a frame counter and a flow state the test moves by hand. */
type FakeGame = SettleApp & { frame: number; state: FlowState };

/**
 * Builds a fake game that stands at a path and waits for nothing.
 *
 * @param onFrame - Runs after each frame, with the game.
 * @returns The fake game.
 */
function fakeGame(onFrame: (game: FakeGame) => void = () => undefined): FakeGame {
  const game: FakeGame = {
    frame: 0,
    state: { running: true, path: "board/deliver", stack: [], pending: {}, mode: "live" },
    time: {
      step: () => {
        game.frame += 1;
        onFrame(game);
      }
    },
    flow: { state: () => game.state }
  };

  return game;
}

const place = { test: "reward-popup", where: "step 2 (answer)" };

describe("settle", () => {
  it("runs one more frame after the gate opens, so the ui of a screen it opened is built", async () => {
    const game = fakeGame(fake => {
      if (fake.frame === 3) fake.state = { ...fake.state, pending: { gate: ["claim"] } };
    });

    await settle(game, 600, place);

    expect(game.frame).toBe(4);
  });

  it("steps at least one frame, also when the gate is already open", async () => {
    const game = fakeGame();

    game.state = { ...game.state, pending: { gate: ["play"] } };
    await settle(game, 600, place);

    expect(game.frame).toBe(2);
  });

  it("stops one frame after the graph does not run any more", async () => {
    const game = fakeGame(fake => {
      if (fake.frame === 2) fake.state = { ...fake.state, running: false };
    });

    await settle(game, 600, place);

    expect(game.frame).toBe(3);
  });

  it("lets a load that resolves on a later task finish", async () => {
    const game = fakeGame();

    setTimeout(() => {
      game.state = { ...game.state, pending: { gate: ["claim"] } };
    }, 0);
    await settle(game, 600, place);

    expect(game.state.pending.gate).toEqual(["claim"]);
    expect(game.frame).toBeLessThan(600);
  });

  it("throws after the frame cap, naming the test, the step and the path", async () => {
    const game = fakeGame();

    await expect(settle(game, 5, place)).rejects.toThrow(
      '[game] Visual test "reward-popup", step 2 (answer) did not settle in 5 frames.\n  The graph stands at "board/deliver"; add a step that answers what it waits for.'
    );
    expect(game.frame).toBe(5);
  });
});

describe("frames", () => {
  it("steps the given number of frames, a task apart", async () => {
    const game = fakeGame();

    await frames(game, 2);

    expect(game.frame).toBe(2);
  });
});
