/**
 * @file The keyboard of Timber Town, headless (design §4): Escape closes a dismissable popup
 * (Settings, Out of energy, Daily gift) and never Reward or Confirm; Tab walks the controls of
 * the top popup and Enter taps the focused one. Keys go in through `app.input.pressKey`, the same
 * listeners a `keydown` on the page reaches.
 */

import type { Ui } from "@moku-labs/game";
import { describe, expect, it } from "vitest";
import type { Player } from "./merge-game/state";
import { generatorId } from "./merge-game/tables";
import type { Game } from "./timber-helpers";
import {
  frames,
  nodeOf,
  player,
  playerOf,
  shows,
  startOnBoard,
  startOnHome,
  tap,
  tick,
  until
} from "./timber-helpers";

/** The same board with an empty energy bar: the sawmill answers with the Out of energy popup. */
const emptyBar: Player = {
  ...player,
  merge: { ...player.merge, energy: { ...player.merge.energy, value: 0 } }
};

/**
 * Presses one key and lets the flow and the frames follow it.
 *
 * @param game - The running game.
 * @param key - The key, as `KeyboardEvent.key` names it.
 * @param shift - Whether Shift is held.
 * @returns Whether a listener handled the key.
 */
async function press(game: Game, key: string, shift = false): Promise<boolean> {
  const handled = game.app.input.pressKey(key, { shift });

  await tick();
  await frames(game, 30);

  return handled;
}

/**
 * The key of the element the keyboard focused.
 *
 * @param node - The snapshot to search.
 * @returns The key, or `undefined` when nothing has the focus.
 */
function focusedIn(node: Ui.UiNode): string | undefined {
  if (node.state.focus) return node.key;

  for (const child of node.children) {
    const found = focusedIn(child);

    if (found !== undefined) return found;
  }

  return undefined;
}

describe("timber-keyboard — Escape", () => {
  it("closes Settings from Home", async () => {
    const game = await startOnHome(player);

    await tap(game, "homeSettings");

    expect(await press(game, "Escape")).toBe(true);
    expect(game.app.flow.state().path).toBe("home");
    expect(shows(game, "settingsScreen")).toBe(false);

    await game.app.stop();
  });

  it("closes the daily gift with nothing paid", async () => {
    const game = await startOnHome(player);
    const coins = playerOf(game).merge.wallet.coins;

    await tap(game, "gift");

    expect(await press(game, "Escape")).toBe(true);
    expect(game.app.flow.state().path).toBe("home");
    expect(playerOf(game).merge.wallet.coins).toBe(coins);
    expect(playerOf(game).giftClaimed).toBe(false);

    await game.app.stop();
  });

  it("closes Out of energy back to the board", async () => {
    const game = await startOnBoard(emptyBar);
    const sawmill = game.app.world.projection.entityOf("board.generators", generatorId) ?? 0;

    game.app.input.tap(sawmill);
    await tick();
    await frames(game);

    expect(shows(game, "energyScreen")).toBe(true);
    expect(await press(game, "Escape")).toBe(true);
    expect(game.app.flow.state().path).toBe("board/awaitIntent");

    await game.app.stop();
  });

  it("never closes Confirm, and the Settings under it stays", async () => {
    const game = await startOnHome(player);

    await tap(game, "homeSettings");
    await tap(game, "settingsReset");

    expect(await press(game, "Escape")).toBe(false);
    expect(game.app.flow.state().path).toBe("settings/confirm");

    await game.app.stop();
  });

  it("never closes the reward", async () => {
    const game = await startOnBoard(player);

    await tap(game, "deliver0");
    await until(game, () => shows(game, "rewardClaim"));

    expect(await press(game, "Escape")).toBe(false);
    expect(shows(game, "rewardClaim")).toBe(true);

    await game.app.stop();
  });
});

describe("timber-keyboard — Tab and Enter", () => {
  it("walks the controls of Settings and taps the focused one with Enter", async () => {
    const game = await startOnHome(player);

    await tap(game, "homeSettings");

    const seen: string[] = [];

    for (let step = 0; step < 12; step += 1) {
      expect(await press(game, "Tab")).toBe(true);
      seen.push(focusedIn(game.app.ui.tree()) ?? "");
    }

    // Every control of the popup is reached: the X, both tabs, − and + of each row, the link.
    expect(seen).toEqual(
      expect.arrayContaining([
        "settingsBoardClose",
        "musicDown",
        "musicUp",
        "sfxDown",
        "settingsReset"
      ])
    );

    while (focusedIn(game.app.ui.tree()) !== "musicDown") await press(game, "Tab");

    expect(await press(game, "Enter")).toBe(true);
    expect(playerOf(game).settings.audio.music).toBe(0.5);
    expect(nodeOf(game.app.ui.tree(), "musicDown")?.state.focus).toBe(true);

    await game.app.stop();
  });
});
