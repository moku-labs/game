/**
 * @file The one state rule set of the Timber Town controls, headless (design §4, §6 G): a plank
 * lifts under the mouse and sinks when pressed, a round button does the same, a disabled plank is
 * the grey plank that neither lifts nor answers, a plank turns grey and back as the rules allow,
 * and the current language is the green plank with a check. The mouse is the `PointerOver` tag and
 * the finger the `Pressed` tag the input plugin writes; `ui` reads both as `is.hover` and
 * `is.pressed`. The HUD row draws its round buttons at 120 units and its pills at the ratio of
 * their art, the icon hanging over the left end (design §6 B1, F4).
 */

import { NineSlice, PointerOver, Pressed, Tappable, Text, Transform } from "@moku-labs/game";
import { describe, expect, it } from "vitest";
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

    // The plank on the board fills the first order only.
    expect(ecs.get(elementOf(game, "deliver0"), NineSlice)?.texture).toBe("ui.button-green");
    expect(ecs.get(waiting, NineSlice)?.texture).toBe("ui.button-disabled");

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

    expect(ecs.get(elementOf(game, "deliver1"), NineSlice)?.texture).toBe("ui.button-disabled");

    // Two twigs make the second log the second order asks for; the first already lies on c2_2.
    game.app.input.drag(
      { projection: "board.items", key: "i1" },
      { projection: "board.items", key: "i2" }
    );
    await tick();
    await frames(game);

    const ready = elementOf(game, "deliver1");

    expect(ecs.get(ready, NineSlice)?.texture).toBe("ui.button-green");
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
