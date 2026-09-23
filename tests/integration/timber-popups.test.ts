/**
 * @file The popups of Timber Town, headless: Settings from Home and from the board, two volume
 * steps on one popup root, the swing in, Confirm stacked over Settings with the recede, Cancel and
 * Reset, the Out of energy popup with its refill and Later, the board-full toast, the daily gift
 * and the reward claim with the coins that fly to the counter. Plain Bun: the renderer is inert,
 * Yoga lays out the real rects, the flow runner and `anim` run for real.
 */

import { NineSlice, Sprite, Tappable, Transform } from "@moku-labs/game";
import { describe, expect, it } from "vitest";
import { TOAST_HOLD_MS } from "./merge-game/features/board/toast";
import { hudRowHeight } from "./merge-game/features/hud/styles";
import type { Item } from "./merge-game/rules";
import type { Player } from "./merge-game/state";
import { startingPlayer } from "./merge-game/state";
import { generatorId } from "./merge-game/tables";
import {
  coinsInFlight,
  counterOf,
  elementOf,
  frames,
  nodeOf,
  player,
  playerOf,
  popupNodes,
  resolvedOf,
  shows,
  spawnedByAnim,
  startOnBoard,
  startOnHome,
  tap,
  tick,
  until,
  withItems
} from "./timber-helpers";

/** The same board with an empty energy bar: the sawmill answers with the Out of energy popup. */
const emptyBar: Player = {
  ...player,
  merge: { ...player.merge, energy: { ...player.merge.energy, value: 0 } }
};

/** Every cell but the sawmill's holds a twig: the sawmill answers with the toast. */
const fullBoard: Player = withItems(
  ["c1_0", "c2_0", "c0_1", "c1_1", "c2_1", "c0_2", "c1_2", "c2_2"].map(
    (cell, index): Item => ({ id: `i${index + 1}`, chain: "wood", level: 1, cell })
  )
);

describe("timber-popups — Settings", () => {
  it("opens from Home and takes two volume steps on the same popup root", async () => {
    const game = await startOnHome(player);

    await tap(game, "homeSettings");

    expect(game.app.flow.state().path).toBe("settings/open");
    expect(resolvedOf(game, "settingsBoardTitle")).toBe("Настройки");
    expect(resolvedOf(game, "musicPercent")).toBe("60 %");

    const root = elementOf(game, "settingsScreen");

    await tap(game, "musicDown");
    await tap(game, "musicDown");

    expect(playerOf(game).settings.audio.music).toBe(0.4);
    expect(game.app.flow.state().path).toBe("settings/open");
    // The popup was reused: the same root entity, never mounted again.
    expect(elementOf(game, "settingsScreen")).toBe(root);
    expect(resolvedOf(game, "musicPercent")).toBe("40 %");

    await tap(game, "settingsBackdrop");
    await frames(game, 30);

    expect(game.app.flow.state().path).toBe("home");
    expect(shows(game, "settingsScreen")).toBe(false);

    await game.app.stop();
  });

  it("opens from the board, disables + at 100 % and closes with the X", async () => {
    const game = await startOnBoard(player);

    await tap(game, "settings");

    expect(game.app.flow.state().path).toBe("board/settings/open");
    // Effects are at 100 %: + is the grey plank and answers nothing, − still answers.
    expect(nodeOf(game.app.ui.tree(), "sfxUp")?.state.disabled).toBe(true);
    expect(game.app.world.ecs.has(elementOf(game, "sfxUp"), Tappable)).toBe(false);

    await tap(game, "sfxDown");

    expect(playerOf(game).settings.audio.sfx).toBe(0.9);
    expect(game.app.world.ecs.has(elementOf(game, "sfxUp"), Tappable)).toBe(true);

    await tap(game, "settingsBoardClose");
    await frames(game, 30);

    expect(game.app.flow.state().path).toBe("board/awaitIntent");
    expect(shows(game, "settingsScreen")).toBe(false);

    await game.app.stop();
  });

  it("takes two volume steps from the board on the same popup root", async () => {
    const game = await startOnBoard(player);

    await tap(game, "settings");

    const root = elementOf(game, "settingsScreen");

    await tap(game, "musicUp");
    await tap(game, "musicUp");

    expect(playerOf(game).settings.audio.music).toBe(0.8);
    expect(game.app.flow.state().path).toBe("board/settings/open");
    expect(elementOf(game, "settingsScreen")).toBe(root);
    expect(resolvedOf(game, "musicPercent")).toBe("80 %");

    await game.app.stop();
  });

  it("swings the signboard in from its tilted, small pose to its fitted rest", async () => {
    const game = await startOnHome(player);

    expect(game.app.input.tap(elementOf(game, "homeSettings"))).toBe(true);
    await tick();
    await frames(game, 1);

    const board = elementOf(game, "settingsBoard");
    const tilts: number[] = [];

    for (let frame = 0; frame < 40; frame += 1) {
      tilts.push(game.app.world.ecs.get(board, Transform)?.rotation ?? 0);
      await frames(game, 1);
    }

    // It starts turned back by up to 0.12 rad around its top edge and comes to rest upright.
    expect(Math.min(...tilts)).toBeLessThan(-0.06);
    expect(Math.min(...tilts)).toBeGreaterThanOrEqual(-0.12);
    expect(game.app.world.ecs.get(board, Transform)).toMatchObject({
      rotation: 0,
      scale: nodeOf(game.app.ui.tree(), "settingsBoard")?.fitScale ?? 1
    });

    await game.app.stop();
  });
});

describe("timber-popups — Confirm over Settings", () => {
  it("covers every element of Settings, and Cancel uncovers the same root", async () => {
    const game = await startOnHome(player);

    await tap(game, "homeSettings");

    const root = elementOf(game, "settingsScreen");

    await tap(game, "settingsReset");

    expect(game.app.flow.state().path).toBe("settings/confirm");
    expect(elementOf(game, "settingsScreen")).toBe(root);
    expect(popupNodes(game, "settingsScreen").every(node => node.state.covered)).toBe(true);
    expect(popupNodes(game, "confirmScreen").some(node => node.state.covered)).toBe(false);
    // Only the top popup answers: the X of the covered settings swallows the tap.
    expect(game.app.input.tap(elementOf(game, "settingsBoardClose"))).toBe(false);

    await tap(game, "confirmCancel");
    await frames(game, 30);

    expect(game.app.flow.state().path).toBe("settings/open");
    expect(elementOf(game, "settingsScreen")).toBe(root);
    expect(popupNodes(game, "settingsScreen").some(node => node.state.covered)).toBe(false);
    expect(shows(game, "confirmScreen")).toBe(false);

    await game.app.stop();
  });

  it("recedes the covered signboard and hides its ropes and X, and its planks answer nothing", async () => {
    const game = await startOnHome(player);

    await tap(game, "homeSettings");
    await tap(game, "settingsReset");
    await frames(game, 30);

    // Smaller, a little higher and darker (design §6 F2).
    expect(nodeOf(game.app.ui.tree(), "settingsBoard")?.style).toMatchObject({
      scale: 0.84,
      offsetY: -8,
      tint: 0x6b_6b_6b
    });
    expect(
      ["settingsBoardRopeLeft", "settingsBoardRopeRight", "settingsBoardClose"].map(
        key => nodeOf(game.app.ui.tree(), key)?.style.alpha
      )
    ).toEqual([0, 0, 0]);
    // A volume plank of the covered popup is still enabled, yet only the top popup answers.
    expect(game.app.input.tap(elementOf(game, "musicDown"))).toBe(false);

    await tick();
    await frames(game);

    expect(game.app.flow.state().path).toBe("settings/confirm");
    expect(playerOf(game).settings.audio.music).toBe(0.6);

    await game.app.stop();
  });

  it("starts the progress over on Reset and unmounts both popups", async () => {
    const played: Player = {
      ...player,
      merge: { ...player.merge, wallet: { coins: 125 } },
      giftClaimed: true,
      settings: { ...player.settings, locale: "ru", audio: { master: 1, music: 0.3, sfx: 1 } }
    };
    const game = await startOnHome(played);

    await tap(game, "homeSettings");
    await tap(game, "settingsReset");
    await tap(game, "confirmReset");
    await frames(game, 30);

    expect(game.app.flow.state().path).toBe("home");
    expect(playerOf(game)).toMatchObject({
      merge: startingPlayer.merge,
      giftClaimed: false,
      claimed: [],
      // The settings survive a reset.
      settings: { audio: { music: 0.3 } }
    });
    expect(shows(game, "settingsScreen")).toBe(false);
    expect(shows(game, "confirmScreen")).toBe(false);
    // The gift waits again.
    expect(resolvedOf(game, "giftBadgeCount")).toBe("1");

    await game.app.stop();
  });
});

describe("timber-popups — the sawmill says why", () => {
  it("opens Out of energy on an empty bar and refills it on Watch", async () => {
    const game = await startOnBoard(emptyBar);
    const sawmill = game.app.world.projection.entityOf("board.generators", generatorId) ?? 0;

    expect(game.app.input.tap(sawmill)).toBe(true);
    await tick();
    await frames(game);

    expect(game.app.flow.state().path).toBe("board/energy");
    expect(resolvedOf(game, "energyRefill")).toBe("Пополнится через 10:00");

    await tap(game, "energyWatch");
    await frames(game, 30);

    expect(game.app.flow.state().path).toBe("board/awaitIntent");
    expect(playerOf(game).merge.energy.value).toBe(10);
    expect(resolvedOf(game, "energyPillText")).toBe("10/10");
    expect(shows(game, "energyScreen")).toBe(false);

    await game.app.stop();
  });

  it("goes back to the board with nothing changed when the backdrop is tapped", async () => {
    const game = await startOnBoard(emptyBar);
    const sawmill = game.app.world.projection.entityOf("board.generators", generatorId) ?? 0;

    game.app.input.tap(sawmill);
    await tick();
    await frames(game);
    await tap(game, "energyBackdrop");

    expect(game.app.flow.state().path).toBe("board/awaitIntent");
    expect(playerOf(game).merge.energy.value).toBe(0);

    await game.app.stop();
  });

  it("goes back to the board with the bar still empty on Later", async () => {
    const game = await startOnBoard(emptyBar);
    const sawmill = game.app.world.projection.entityOf("board.generators", generatorId) ?? 0;

    game.app.input.tap(sawmill);
    await tick();
    await frames(game);
    await tap(game, "energyLater");
    await frames(game, 30);

    expect(game.app.flow.state().path).toBe("board/awaitIntent");
    expect(playerOf(game).merge.energy.value).toBe(0);
    expect(shows(game, "energyScreen")).toBe(false);

    await game.app.stop();
  });

  it("swings the board-full toast in under the HUD and despawns it after the timeline", async () => {
    const game = await startOnBoard(fullBoard);
    const sawmill = game.app.world.projection.entityOf("board.generators", generatorId) ?? 0;

    expect(game.app.input.tap(sawmill)).toBe(true);
    await tick();
    await frames(game, 2);

    // The toast never blocks: the board is back at once, with the two toast entities on top.
    expect(game.app.flow.state().path).toBe("board/awaitIntent");

    const toast = spawnedByAnim(game);

    expect(toast.map(entity => Object.keys(entity.components).includes("NineSlice"))).toEqual([
      true,
      false
    ]);

    const sign = toast[0]?.id ?? 0;
    const hud = elementOf(game, "hudRow");
    const hudTop = game.app.world.ecs.get(hud, Transform)?.y ?? 0;

    expect(game.app.world.ecs.get(sign, NineSlice)?.texture).toBe("ui.button-berry");
    expect(game.app.world.ecs.get(sign, Transform)?.y).toBe(hudTop + hudRowHeight / 2 + 33);

    await frames(game, Math.ceil((TOAST_HOLD_MS + 700) / 16));

    expect(spawnedByAnim(game)).toEqual([]);

    await game.app.stop();
  });
});

describe("timber-popups — the daily gift", () => {
  it("pays 50 coins on Claim, clears the badge and flies eight coins to the counter", async () => {
    const game = await startOnHome(player);

    expect(resolvedOf(game, "giftBadgeCount")).toBe("1");

    await tap(game, "gift");

    expect(game.app.flow.state().path).toBe("dailyGift");
    expect(resolvedOf(game, "giftReward")).toBe("+50 монет");

    await tap(game, "giftClaim");

    expect(game.app.flow.state().path).toBe("home");
    expect(playerOf(game)).toMatchObject({ giftClaimed: true, merge: { wallet: { coins: 50 } } });
    expect(coinsInFlight(game)).toBe(8);
    expect(shows(game, "giftBadge")).toBe(false);

    await frames(game, 90);

    expect(coinsInFlight(game)).toBe(0);
    expect(counterOf(game)).toBe("50");

    await game.app.stop();
  });
});

describe("timber-popups — the reward", () => {
  it("flies seven coins from the reward picture and rolls the counter to the new sum", async () => {
    const game = await startOnBoard(player);

    await tap(game, "deliver0");
    await until(game, () => shows(game, "rewardClaim"));
    await frames(game);

    expect(game.app.flow.state().path).toBe("afterOrder/show");
    expect(resolvedOf(game, "rewardCoins")).toBe("+25");
    expect(game.app.world.ecs.get(elementOf(game, "rewardPrizePicture"), Sprite)?.texture).toBe(
      "board.item-wood-3"
    );

    await tap(game, "rewardClaim");

    expect(coinsInFlight(game)).toBe(7);
    expect(counterOf(game)).toBe("0");

    await frames(game, 90);

    expect(coinsInFlight(game)).toBe(0);
    expect(counterOf(game)).toBe("25");
    expect(game.app.flow.state().path).toBe("board/awaitIntent");

    await game.app.stop();
  });
});
