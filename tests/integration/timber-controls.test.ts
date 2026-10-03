/**
 * @file The one state rule set of the Timber Town controls, headless (design §4, §6 G): a plank
 * lifts under the mouse and sinks when pressed, a round button does the same, a disabled plank is
 * the grey plank that neither lifts nor answers, a plank turns grey and back as the rules allow,
 * and the current language is the green plank with a check. The mouse is the `PointerOver` tag and
 * the finger the `Pressed` tag the input plugin writes; `ui` reads both as `is.hover` and
 * `is.pressed`. The HUD row draws its round buttons at 120 units and its pills at the ratio of
 * their art, the icon hanging over the left end (design §6 B1, F4). A control drawn shorter than
 * 44 pt on the smallest phone takes its taps on a taller, invisible box around unchanged art.
 */

import { NineSlice, PointerOver, Pressed, Shape, Tappable, Text, Transform } from "@moku-labs/game";
import { describe, expect, it } from "vitest";
import { TAP_MIN } from "./merge-game/features/ui/kit";
import type { Game } from "./timber-helpers";
import {
  elementOf,
  frames,
  nodeOf,
  player,
  playerOf,
  shows,
  startOnBoard,
  startOnHome,
  tap,
  tick,
  withItems
} from "./timber-helpers";

/** Two twigs side by side: a drag merges them into the log the second order asks for. */
const twoTwigs = withItems([
  { id: "i1", chain: "wood", level: 1, cell: "c1_0" },
  { id: "i2", chain: "wood", level: 1, cell: "c2_0" },
  { id: "i3", chain: "wood", level: 2, cell: "c2_2" }
]);

/**
 * The look of one keyed control: the flags `ui` resolved, the offset and scale of its style, and
 * the scale of its rest `Transform`.
 *
 * @param game - The running game.
 * @param key - The key of the control.
 * @returns What the control looks like now.
 */
function lookOf(game: Game, key: string) {
  const node = nodeOf(game.app.ui.tree(), key);

  return {
    hover: node?.state.hover,
    pressed: node?.state.pressed,
    offsetY: node?.style.offsetY,
    scale: node?.style.scale,
    drawn: game.app.world.ecs.get(elementOf(game, key), Transform)?.scale
  };
}

describe("timber-controls — hover and pressed", () => {
  it("lifts the Play plank under the mouse, sinks it when pressed and lets it go", async () => {
    const game = await startOnHome(player);
    const ecs = game.app.world.ecs;
    const play = elementOf(game, "play");

    expect(lookOf(game, "play")).toEqual({
      hover: false,
      pressed: false,
      offsetY: undefined,
      scale: undefined,
      drawn: 1
    });

    ecs.tag(play, PointerOver);
    await frames(game, 2);

    expect(lookOf(game, "play")).toEqual({
      hover: true,
      pressed: false,
      offsetY: -4,
      scale: 1.03,
      drawn: 1.03
    });

    // Pressed is applied after hover: the plank sinks onto its lip.
    ecs.tag(play, Pressed);
    await frames(game, 2);

    expect(lookOf(game, "play")).toEqual({
      hover: true,
      pressed: true,
      offsetY: 6,
      scale: 0.97,
      drawn: 0.97
    });

    ecs.untag(play, Pressed);
    ecs.untag(play, PointerOver);
    await frames(game, 2);

    expect(lookOf(game, "play")).toEqual({
      hover: false,
      pressed: false,
      offsetY: undefined,
      scale: undefined,
      drawn: 1
    });

    await game.app.stop();
  });

  it("lifts a round wood button with the same rule", async () => {
    const game = await startOnHome(player);

    game.app.world.ecs.tag(elementOf(game, "homeSettings"), PointerOver);
    await frames(game, 2);

    expect(lookOf(game, "homeSettings")).toMatchObject({ hover: true, offsetY: -4, scale: 1.03 });

    await game.app.stop();
  });
});

describe("timber-controls — disabled", () => {
  it("draws a disabled plank grey, keeps it still under the mouse and lets it answer nothing", async () => {
    const game = await startOnBoard(player);
    const ecs = game.app.world.ecs;
    const waiting = elementOf(game, "deliver1");

    // The plank on the board fills the first order only. The art of a short plank is the
    // `<id>Plank` inside its taller tap box.
    expect(ecs.get(elementOf(game, "deliver0Plank"), NineSlice)?.texture).toBe("ui.button-green");
    expect(ecs.get(elementOf(game, "deliver1Plank"), NineSlice)?.texture).toBe(
      "ui.button-disabled"
    );

    ecs.tag(waiting, PointerOver);
    ecs.tag(waiting, Pressed);
    await frames(game, 2);

    // The flags are read, but a disabled control applies neither the lift nor the sink.
    expect(lookOf(game, "deliver1")).toEqual({
      hover: true,
      pressed: true,
      offsetY: undefined,
      scale: undefined,
      drawn: 1
    });
    expect(ecs.has(waiting, Tappable)).toBe(false);
    expect(game.app.input.tap(waiting)).toBe(false);

    await tick();
    await frames(game);

    expect(game.app.flow.state().path).toBe("board/awaitIntent");
    expect(playerOf(game).merge.orders).toEqual(player.merge.orders);

    await game.app.stop();
  });

  it("turns the grey plank green the moment the rules accept its order", async () => {
    const game = await startOnBoard(twoTwigs);
    const ecs = game.app.world.ecs;

    expect(ecs.get(elementOf(game, "deliver1Plank"), NineSlice)?.texture).toBe(
      "ui.button-disabled"
    );

    // Two twigs make the second log the second order asks for; the first already lies on c2_2.
    game.app.input.drag(
      { projection: "board.items", key: "i1" },
      { projection: "board.items", key: "i2" }
    );
    await tick();
    await frames(game);

    const ready = elementOf(game, "deliver1");

    expect(ecs.get(elementOf(game, "deliver1Plank"), NineSlice)?.texture).toBe("ui.button-green");
    expect(ecs.has(ready, Tappable)).toBe(true);
    expect(nodeOf(game.app.ui.tree(), "deliver1")?.state.disabled).toBe(false);

    await game.app.stop();
  });
});

describe("timber-controls — selected", () => {
  it("draws the current language as the green plank with a check", async () => {
    const game = await startOnHome(player);
    const ecs = game.app.world.ecs;

    await tap(game, "homeSettings");
    // The tab is local state: it swaps the pane and answers no gate.
    game.app.input.tap(elementOf(game, "tabLanguage"));
    await frames(game);

    expect(ecs.get(elementOf(game, "languageRussian"), NineSlice)?.texture).toBe("ui.button-green");
    expect(ecs.get(elementOf(game, "languageEnglish"), NineSlice)?.texture).toBe("ui.button-wood");
    expect(shows(game, "languageRussianCheck")).toBe(true);
    expect(shows(game, "languageEnglishCheck")).toBe(false);

    await game.app.stop();
  });
});

describe("timber-controls — the HUD row", () => {
  it("draws home and gear as 120-unit round buttons and the pills at the ratio of their art", async () => {
    const game = await startOnBoard(player);
    const tree = game.app.ui.tree();
    const rect = (key: string) => nodeOf(tree, key)?.rect ?? { x: 0, y: 0, w: 0, h: 0 };

    expect([rect("home").w, rect("home").h, rect("settings").w, rect("settings").h]).toEqual([
      120, 120, 120, 120
    ]);

    for (const key of ["coinPill", "energyPill"]) {
      const bar = rect(key);
      const icon = rect(`${key}Icon`);

      // The bar keeps the height ratio of its 300×63 art; the 110-unit icon hangs over its left end.
      expect(bar.h, key).toBe(76);
      expect([icon.w, icon.h], key).toEqual([110, 110]);
      expect(icon.x, key).toBe(bar.x - 36);
      expect(icon.y + icon.h / 2, key).toBe(bar.y + bar.h / 2);
    }

    // The coin counter sits in the middle of the bar right of the icon, in the pill's own units.
    const counter = game.app.world.projection.entityOf("hud.coins", "coins") ?? 0;

    expect(game.app.world.ecs.get(counter, Text)?.anchor).toEqual({ x: 0.5, y: 0.5 });
    expect(game.app.world.ecs.get(counter, Transform)).toMatchObject({ x: 175, y: 38 });

    await game.app.stop();
  });
});

/**
 * The scale the smallest phone the game is checked on draws at: the iPhone SE, 375 × 667 pt, over
 * the 1080 × 2100 reference of the fixture (`referenceLong: 2100`).
 */
const smallestScale = Math.min(375 / 1080, 667 / 2100);

describe("timber-controls — tap targets of 44 pt", () => {
  it("is 44 pt on the smallest phone", () => {
    expect(TAP_MIN * smallestScale).toBeGreaterThanOrEqual(44);
  });

  it("takes the taps of a Deliver on a tap box around its plank, which stays where it was drawn", async () => {
    const game = await startOnBoard(player);
    const tree = game.app.ui.tree();
    const box = nodeOf(tree, "deliver0")?.rect ?? { x: 0, y: 0, w: 0, h: 0 };
    const plank = nodeOf(tree, "deliver0Plank")?.rect ?? { x: 0, y: 0, w: 0, h: 0 };
    const reward = nodeOf(tree, "card0Reward")?.rect ?? { x: 0, y: 0, w: 0, h: 0 };

    // The art: 250 × 96, under the reward row (its margin 17 and the gap 9 of the card).
    expect(plank).toMatchObject({ w: 250, h: 96, y: reward.y + reward.h + 17 + 9 });
    // The tap box: as wide, TAP_MIN tall, centred on the art, and drawing nothing of its own.
    expect(box).toEqual({ x: plank.x, y: plank.y - (TAP_MIN - 96) / 2, w: 250, h: TAP_MIN });
    expect(game.app.world.ecs.get(elementOf(game, "deliver0"), Shape)).toMatchObject({
      w: 250,
      h: TAP_MIN,
      fillAlpha: 0,
      strokeWidth: 0
    });
    expect(game.app.world.ecs.has(elementOf(game, "deliver0"), Tappable)).toBe(true);

    await game.app.stop();
  });

  it("takes the taps of the reset link on a box at least TAP_MIN tall, its words where they were", async () => {
    const game = await startOnHome(player);

    await tap(game, "homeSettings");

    const tree = game.app.ui.tree();
    const link = nodeOf(tree, "settingsReset")?.rect ?? { x: 0, y: 0, w: 0, h: 0 };
    const words = nodeOf(tree, "settingsResetLabel")?.rect ?? { x: 0, y: 0, w: 0, h: 0 };
    const wave = nodeOf(tree, "settingsResetWave")?.rect ?? { x: 0, y: 0, w: 0, h: 0 };
    const paper = nodeOf(tree, "settingsPane")?.rect ?? { x: 0, y: 0, w: 0, h: 0 };

    expect(link.h).toBeGreaterThanOrEqual(TAP_MIN);
    // 22 units of reach and the 8 of padding above the words, as many under the wave.
    expect(words.y - link.y).toBe(30);
    expect(link.y + link.h - (wave.y + wave.h)).toBe(30);
    // The words still stand the board's gap of 24 plus the old padding of 8 under the paper.
    expect(words.y - (paper.y + paper.h)).toBe(24 + 8);

    await game.app.stop();
  });
});
