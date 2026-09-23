/**
 * @file The popups of Timber Town, headless: Settings from Home and from the board, two volume
 * steps on one popup root, the swing in, Confirm stacked over Settings with the recede, Cancel and
 * Reset, the Out of energy popup with its refill and Later, the board-full toast, the daily gift
 * and the reward claim with the coins that fly to the counter. Plain Bun: the renderer is inert,
 * Yoga lays out the real rects, the flow runner and `anim` run for real.
 */

import { NineSlice, Sprite, Tappable, Text, Transform } from "@moku-labs/game";
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

  it("drops the signboard from above the screen, overshoots with a turn and wobbles to rest", async () => {
    const game = await startOnHome(player);

    expect(game.app.input.tap(elementOf(game, "homeSettings"))).toBe(true);
    await tick();
    await frames(game, 1);

    const board = elementOf(game, "settingsBoard");
    const poses: { y: number; rotation: number }[] = [];

    for (let frame = 0; frame < 70; frame += 1) {
      const pose = game.app.world.ecs.get(board, Transform);

      poses.push({ y: pose?.y ?? 0, rotation: pose?.rotation ?? 0 });
      await frames(game, 1);
    }

    const rest = game.app.world.ecs.get(board, Transform);
    const turns = poses.map(pose => pose.rotation);

    // It starts high above its rest (the key at 0 is 780 units up) ...
    expect((poses[0]?.y ?? 0) - (rest?.y ?? 0)).toBeLessThan(-600);
    // ... swings past upright to +5° on the overshoot and back to −3.2° in the wobble ...
    expect(Math.max(...turns)).toBeGreaterThan(4 * (Math.PI / 180));
    expect(Math.max(...turns)).toBeLessThanOrEqual(5 * (Math.PI / 180) + 1e-9);
    expect(Math.min(...turns)).toBeLessThan(-3 * (Math.PI / 180));
    // ... and ends upright at its fitted rest, turning around the rope point above it.
    expect(rest).toMatchObject({
      rotation: 0,
      scale: nodeOf(game.app.ui.tree(), "settingsBoard")?.fitScale ?? 1
    });
    expect(nodeOf(game.app.ui.tree(), "settingsBoard")?.style.origin).toEqual({ x: 0.5, y: -0.5 });

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

    // Smaller, a little higher and darker (design §6 F2). The board turns around the rope point
    // half its height above it, so the shrink alone would lift it by 16 % of its 1060 units; the
    // offset gives that back, and the board shrinks around its middle and rises 8.
    expect(nodeOf(game.app.ui.tree(), "settingsBoard")?.style).toMatchObject({
      scale: 0.84,
      offsetY: Math.round(0.16 * 1060) - 8,
      tint: 0x6b_6b_6b
    });
    expect(
      [
        "settingsBoardRopeLeft",
        "settingsBoardRopeLeft0",
        "settingsBoardRopeRight",
        "settingsBoardRopeRight2",
        "settingsBoardClose"
      ].map(key => nodeOf(game.app.ui.tree(), key)?.style.alpha)
    ).toEqual([0, 0, 0, 0, 0]);
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
    // The wait sits on its own line of the parchment chip (design §6 E4).
    expect(resolvedOf(game, "energyRefill")).toBe("Пополнится через\n10:00");

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
    // The big "+50" and the word after it (design §6 E5).
    expect(resolvedOf(game, "giftReward")).toBe("+50");
    expect(resolvedOf(game, "giftRewardUnit")).toBe("монет");

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

/**
 * The natural rect of one keyed element, failing the test when it is not on the screen.
 *
 * @param game - The running game.
 * @param key - The key of the element.
 * @returns Its rect in root space.
 */
function rectOf(game: Awaited<ReturnType<typeof startOnHome>>, key: string) {
  const node = nodeOf(game.app.ui.tree(), key);

  expect(node, key).toBeDefined();

  return node?.rect ?? { x: 0, y: 0, w: 0, h: 0 };
}

describe("timber-popups — the look of a popup board", () => {
  it("centres a title plaque on the top edge of every board, half of it above", async () => {
    const game = await startOnBoard(emptyBar);
    const plaques: { board: string; header: string }[] = [];

    await tap(game, "settings");
    plaques.push({ board: "settingsBoard", header: "settingsBoardHeader" });
    await tap(game, "settingsReset");
    plaques.push({ board: "confirmBoard", header: "confirmBoardHeader" });

    for (const { board, header } of plaques) {
      const panel = rectOf(game, board);
      const plaque = rectOf(game, header);

      // 150 units tall, centred on the top edge: half of it above the board, half on it.
      expect(plaque.h, header).toBe(150);
      expect(plaque.y + plaque.h / 2, header).toBe(panel.y);
      expect(plaque.x + plaque.w / 2, header).toBe(panel.x + panel.w / 2);
      // As wide as its title and 80 units on each side, never under 420.
      expect(plaque.w, header).toBeGreaterThanOrEqual(420);
      expect(plaque.w, header).toBe(Math.max(420, rectOf(game, `${board}Title`).w + 160));
      // Hung a little crooked: 1.5 degrees to the left, turning around its middle.
      expect(nodeOf(game.app.ui.tree(), header)?.style.rotation, header).toBe(-0.026);
      expect(game.app.world.ecs.get(elementOf(game, header), Transform)?.rotation, header).toBe(
        -0.026
      );
    }

    await game.app.stop();
  });

  it("hangs the board on two ropes from far above the screen, 18 % in from each side", async () => {
    const game = await startOnHome(player);

    await tap(game, "gift");

    const board = rectOf(game, "giftBoard");
    const left = rectOf(game, "giftBoardRopeLeft");
    const right = rectOf(game, "giftBoardRopeRight");

    // The ropes end on the top edge of the board and reach far past the top of the screen.
    expect(left.y + left.h).toBe(board.y);
    expect(right.y + right.h).toBe(board.y);
    expect(left.y).toBeLessThan(-1000);
    expect(left.x + left.w / 2 - board.x).toBeCloseTo(board.w * 0.18, 0);
    expect(board.x + board.w - (right.x + right.w / 2)).toBeCloseTo(board.w * 0.18, 0);

    await game.app.stop();
  });

  it("shows a reward on its rays with no disc, and the amount in the big number voice", async () => {
    const game = await startOnBoard(player);

    await tap(game, "deliver0");
    await until(game, () => shows(game, "rewardClaim"));
    await frames(game);

    expect(shows(game, "rewardPrizeRays")).toBe(true);
    expect(shows(game, "rewardPrizeDisc")).toBe(false);
    expect(game.app.world.ecs.get(elementOf(game, "rewardCoins"), Text)?.style).toBe("ui.amount");
    expect(rectOf(game, "rewardClaim")).toMatchObject({ w: 554, h: 150 });

    await game.app.stop();
  });

  it("writes the refill on a parchment chip and gives Watch the full width and a play glyph", async () => {
    const game = await startOnBoard(emptyBar);
    const sawmill = game.app.world.projection.entityOf("board.generators", generatorId) ?? 0;

    game.app.input.tap(sawmill);
    await tick();
    await frames(game);

    const board = rectOf(game, "energyBoard");
    const watch = rectOf(game, "energyWatch");

    expect(nodeOf(game.app.ui.tree(), "energyTimer")?.style.nineSlice).toBe("ui.panel-parchment");
    expect(nodeOf(game.app.ui.tree(), "energyTimer")?.children.map(child => child.key)).toEqual([
      "energyRefill"
    ]);
    // The board's inner width: 840 less 72 on each side.
    expect(watch).toMatchObject({ x: board.x + 72, w: 840 - 2 * 72, h: 200 });
    expect(shows(game, "energyWatchPlay")).toBe(true);
    // The play glyph is a moss triangle with an ink edge in the cream ring, pointing right; no text.
    expect(nodeOf(game.app.ui.tree(), "energyWatchPlayMark")?.style).toMatchObject({
      shape: "triangle",
      stroke: 0x3a_22_12
    });
    expect(game.app.world.ecs.has(elementOf(game, "energyWatchPlayMark"), Text)).toBe(false);
    expect(rectOf(game, "energyLater")).toMatchObject({ w: 554, h: 150 });

    await game.app.stop();
  });

  it("gives the Reset and the Cancel of the confirm the same width", async () => {
    const game = await startOnHome(player);

    await tap(game, "homeSettings");
    await tap(game, "settingsReset");

    const reset = rectOf(game, "confirmReset");
    const cancel = rectOf(game, "confirmCancel");

    expect(reset.w).toBe(cancel.w);
    expect(reset.w).toBeGreaterThan(300);
    expect(nodeOf(game.app.ui.tree(), "confirmBody")?.style.nineSlice).toBe("ui.panel-parchment");

    await game.app.stop();
  });
});

describe("timber-popups — the settings pane", () => {
  it("stands the tabs on the parchment: the open tab reaches down over its border", async () => {
    const game = await startOnHome(player);

    await tap(game, "homeSettings");

    const pane = rectOf(game, "settingsPane");
    const open = rectOf(game, "tabSound");
    const idle = rectOf(game, "tabLanguage");

    // No gap: the open tab ends 12 units inside the paper, the idle one on its edge.
    expect(open.y + open.h).toBe(pane.y + 12);
    expect(idle.y + idle.h).toBe(pane.y);
    expect(open.h).toBeGreaterThan(idle.h);
    expect(nodeOf(game.app.ui.tree(), "tabSound")?.style.nineSlice).toBe("ui.tab-active");
    expect(nodeOf(game.app.ui.tree(), "tabLanguage")?.style.nineSlice).toBe("ui.tab-idle");

    await game.app.stop();
  });

  it("draws each sound row on two lines, the bar filling what − and + leave", async () => {
    const game = await startOnHome(player);

    await tap(game, "homeSettings");

    const row = nodeOf(game.app.ui.tree(), "musicRow");

    expect(row?.children.map(child => child.key)).toEqual(["musicLine", "musicControls"]);

    const controls = rectOf(game, "musicControls");
    const down = rectOf(game, "musicDown");
    const bar = rectOf(game, "musicBar");
    const up = rectOf(game, "musicUp");

    expect([down.w, down.h, up.w, up.h]).toEqual([120, 120, 120, 120]);
    expect(down.x).toBe(controls.x);
    expect(up.x + up.w).toBe(controls.x + controls.w);
    expect(bar.w).toBe(controls.w - 2 * 120 - 2 * 24);
    // The percent sits at the right end of the first line.
    const line = rectOf(game, "musicLine");
    const percent = rectOf(game, "musicPercentBox");

    expect(percent.x + percent.w).toBe(line.x + line.w);

    await game.app.stop();
  });

  it("draws the wave of the reset link as wide as its words", async () => {
    const game = await startOnHome(player);

    await tap(game, "homeSettings");

    const words = rectOf(game, "settingsResetLabel");
    const wave = rectOf(game, "settingsResetWave");

    // Yoga rounds the edges of the link and of its words to whole units apart.
    expect(Math.abs(wave.x - words.x)).toBeLessThanOrEqual(2);
    expect(Math.abs(wave.w - words.w)).toBeLessThanOrEqual(2);
    expect(wave.h).toBe(16);
    expect(wave.y).toBeGreaterThan(words.y + words.h - 1);

    await game.app.stop();
  });
});
