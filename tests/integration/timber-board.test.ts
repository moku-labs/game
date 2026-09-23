/**
 * @file The board screen of Timber Town against the approved p2 screenshot, headless: the column
 * (HUD, order strip, tray, info bar) in the flow with the gaps of the design, the three cards on a
 * sagging rope with the middle one hanging lower, the "×2" badge opposite the level badge on the
 * picture, the honey glow of a ready card, the grass cells with the tray floor between them, the
 * charges plate on the sawmill's cell and the check on the item a ready order takes. Plain Bun:
 * the renderer is inert and Yoga lays out the same rects as in the browser.
 */
import type { Ui } from "@moku-labs/game";
import { Order, Parent, Shape, Sprite, Text, Transform } from "@moku-labs/game";
import { describe, expect, it } from "vitest";
import { startMoment } from "./merge-game/game";
import type { Player } from "./merge-game/state";
import { generatorId } from "./merge-game/tables";
import { cellBox, cellSize, itemSize, slot } from "./merge-game/view/layout";
import type { Game } from "./timber-helpers";
import { elementOf, frames, nodeOf, player, startOnBoard, tap, until } from "./timber-helpers";

/** The walnut of the charges plate, and the honey and ink of its pips (design §2). */
const color = { walnut: 0x6e_41_21, honey: 0xf2_b4_3d, ink: 0x3a_22_12 } as const;

/** The same board with a sawmill that spent one of its four charges. */
const oneSpent: Player = {
  ...player,
  merge: {
    ...player.merge,
    generators: { [generatorId]: { readyAt: startMoment + 60_000, charges: 3 } }
  }
};

/** The laid-out rect of a node of the screen. */
type Rect = Ui.UiNode["rect"];

/** An empty rect, for a node the tree does not have. */
const noRect: Rect = { x: 0, y: 0, w: 0, h: 0 };

/**
 * The laid-out rect of a keyed element.
 *
 * @param game - The running game.
 * @param key - The key of the element.
 * @returns Its rect, empty when it is not on the screen.
 */
function rectOf(game: Game, key: string): Rect {
  return nodeOf(game.app.ui.tree(), key)?.rect ?? noRect;
}

/**
 * The entity of one badge part.
 *
 * @param game - The running game.
 * @param key - The key of the part, such as `"sawmill.plate"`.
 * @returns The entity, `0` when the part is not drawn.
 */
function badgeOf(game: Game, key: string): number {
  return game.app.world.projection.entityOf("board.badges", key) ?? 0;
}

describe("timber-board — the column (p2)", () => {
  it("stacks the strip, the tray and the info bar in the flow with the gaps of the design", async () => {
    const game = await startOnBoard(player);
    const hud = rectOf(game, "hudRow");
    const strip = rectOf(game, "orders");
    const tray = rectOf(game, "boardSlot");
    const bar = rectOf(game, "infoBar");

    expect(strip.y).toBe(hud.y + hud.h + 11);
    expect(tray).toMatchObject({ y: strip.y + strip.h + 24, w: 970, h: 970 });
    expect(tray.x + tray.w / 2).toBe(strip.x + strip.w / 2);
    expect(bar).toMatchObject({ y: tray.y + tray.h + 24, w: 830, h: 160 });
    // The tray is never fitted on its own: the viewport fits the whole column.
    expect(nodeOf(game.app.ui.tree(), "boardSlot")?.fitScale).toBeUndefined();
    // The whole column fits the long side the game declares; the rest is left below the bar.
    expect(bar.y + bar.h).toBeLessThanOrEqual(2100);

    await game.app.stop();
  });

  it("names the sawmill in ink on a light plank", async () => {
    const game = await startOnBoard(oneSpent);
    const bar = nodeOf(game.app.ui.tree(), "infoBar");

    expect(bar?.style.nineSlice).toBe("ui.button-wood");
    expect(game.app.world.ecs.get(elementOf(game, "infoName"), Text)).toMatchObject({
      style: "ui.tab",
      resolved: "Лесопилка"
    });
    expect(game.app.world.ecs.get(elementOf(game, "infoCharges"), Text)?.resolved).toBe("3/4");

    await game.app.stop();
  });
});

describe("timber-board — the order strip (p2)", () => {
  it("hangs the three cards on the sagging rope, the middle one 20 units lower", async () => {
    const game = await startOnBoard(player);
    const strip = rectOf(game, "orders");
    const cards = ["card0", "card1", "card2"].map(key => rectOf(game, key));

    expect(cards.map(card => ({ w: card.w, h: card.h }))).toEqual([
      { w: 300, h: 550 },
      { w: 300, h: 550 },
      { w: 300, h: 550 }
    ]);
    expect(cards.map(card => card.y - strip.y)).toEqual([74, 94, 74]);
    // The cards at the ends fill the strip; the middle one hangs into the gap above the tray.
    expect((cards[0]?.y ?? 0) + (cards[0]?.h ?? 0)).toBe(strip.y + strip.h);
    expect((cards[1]?.y ?? 0) + (cards[1]?.h ?? 0)).toBeLessThan(rectOf(game, "boardSlot").y);
    expect(game.app.world.ecs.get(elementOf(game, "ordersRope"), Sprite)?.texture).toBe(
      "orders.rope"
    );
    expect(nodeOf(game.app.ui.tree(), "card1")?.style.origin).toBe("top");

    await game.app.stop();
  });

  it('puts "×2" on the picture as a badge opposite the level, and names the item alone', async () => {
    const game = await startOnBoard(player);
    const ecs = game.app.world.ecs;
    const picture = rectOf(game, "card1Picture");
    const count = rectOf(game, "card1Count");
    const level = rectOf(game, "card1Level");

    expect(ecs.get(elementOf(game, "card1Name"), Text)?.resolved).toBe("Бревно");
    expect(ecs.get(elementOf(game, "card1CountLabel"), Text)?.resolved).toBe("×2");
    expect(ecs.get(elementOf(game, "card1LevelNumber"), Text)?.resolved).toBe("2");
    // Lower left and lower right of the frame, both over its rim.
    expect(count.x).toBeLessThan(picture.x);
    expect(level.x + level.w).toBeGreaterThan(picture.x + picture.w);
    expect(count.y + count.h).toBeGreaterThan(picture.y + picture.h);
    expect(level.y + level.h).toBeGreaterThan(picture.y + picture.h);
    // An order that asks for one has no count badge.
    expect(nodeOf(game.app.ui.tree(), "card0Count")).toBeUndefined();
    expect(nodeOf(game.app.ui.tree(), "card2Count")).toBeUndefined();

    await game.app.stop();
  });

  it("glows only the card whose order the board can fill", async () => {
    const game = await startOnBoard(player);
    const tree = game.app.ui.tree();

    expect(nodeOf(tree, "card0Glow")).toBeDefined();
    expect(nodeOf(tree, "card1Glow")).toBeUndefined();
    expect(nodeOf(tree, "card2Glow")).toBeUndefined();

    await game.app.stop();
  });
});

describe("timber-board — the tray (p2)", () => {
  it("lays the grass cells out with the tray floor between them and draws items at 82 %", async () => {
    const game = await startOnBoard(player);
    const ecs = game.app.world.ecs;
    const cell = game.app.world.projection.entityOf("board.cells", "c1_1") ?? 0;
    const item = game.app.world.projection.entityOf("board.items", "i1") ?? 0;

    expect(cellSize).toBe(272);
    expect(slot).toMatchObject({ inset: 55, gap: 22 });
    expect(cellBox("c1_0").x - (cellBox("c0_0").x + cellSize)).toBe(22);
    expect(cellBox("c2_2").x + cellSize).toBe(slot.size - slot.inset);
    expect(ecs.get(cell, Transform)).toMatchObject({ x: cellBox("c1_1").x, y: cellBox("c1_1").y });
    expect(ecs.get(item, Sprite)).toMatchObject({ width: itemSize, height: itemSize });
    expect(itemSize).toBe(Math.round(cellSize * 0.82));

    await game.app.stop();
  });
});

describe("timber-board — the badges (p2)", () => {
  it("hangs the charges plate on the sawmill's cell: a pip per charge, the spent ones dark, and the count", async () => {
    const game = await startOnBoard(oneSpent);
    const ecs = game.app.world.ecs;
    const cell = cellBox("c0_0");
    const sawmill = game.app.world.projection.entityOf("board.generators", generatorId) ?? 0;
    const plate = badgeOf(game, `${generatorId}.plate`);
    const pips = [0, 1, 2, 3].map(index => badgeOf(game, `${generatorId}.pip${index}`));
    const count = badgeOf(game, `${generatorId}.count`);

    expect(ecs.get(plate, Shape)).toMatchObject({ fill: color.walnut, stroke: color.ink });
    expect(pips.map(pip => ecs.get(pip, Shape)?.fill)).toEqual([
      color.honey,
      color.honey,
      color.honey,
      color.ink
    ]);
    expect(ecs.get(count, Text)?.resolved).toBe("3/4");
    // On the bottom of the sawmill's cell, over the sawmill, inside the board slot.
    const pose = ecs.get(plate, Transform) ?? Transform.defaults;
    const shape = ecs.get(plate, Shape) ?? Shape.defaults;

    expect(pose.x + shape.w / 2).toBe(cell.middle.x);
    expect(pose.y).toBeGreaterThan(cell.middle.y);
    expect(pose.y).toBeLessThan(cell.y + cell.size);
    expect([plate, ...pips, count].map(entity => ecs.get(entity, Parent)?.entity)).toEqual(
      [plate, ...pips, count].map(() => elementOf(game, "boardSlot"))
    );
    expect(ecs.get(plate, Order)?.value).toBeGreaterThan(ecs.get(sawmill, Order)?.value ?? 0);

    await game.app.stop();
  });

  it("counts the charges down on the plate when the sawmill gives", async () => {
    const game = await startOnBoard(player);
    const count = badgeOf(game, `${generatorId}.count`);

    expect(game.app.world.ecs.get(count, Text)?.resolved).toBe("4/4");

    const sawmill = game.app.world.projection.entityOf("board.generators", generatorId) ?? 0;

    expect(game.app.input.tap(sawmill)).toBe(true);
    await until(game, () => game.app.world.ecs.get(count, Text)?.resolved === "3/4");

    expect(game.app.world.ecs.get(badgeOf(game, `${generatorId}.pip3`), Shape)?.fill).toBe(
      color.ink
    );

    await game.app.stop();
  });

  it("checks the item a ready order takes, on the top right of its cell, and takes it off once given", async () => {
    const game = await startOnBoard(player);
    const ecs = game.app.world.ecs;
    const cell = cellBox("c1_0");
    const plank = game.app.world.projection.entityOf("board.items", "i1") ?? 0;
    const disc = badgeOf(game, "check.i1.disc");
    const mark = badgeOf(game, "check.i1.mark");

    expect(ecs.get(mark, Sprite)?.texture).toBe("ui.icon-check");
    expect(ecs.get(mark, Transform)?.x).toBeGreaterThan(cell.middle.x);
    expect(ecs.get(mark, Transform)?.y).toBeLessThan(cell.middle.y);
    expect(ecs.get(disc, Order)?.value).toBeGreaterThan(ecs.get(plank, Order)?.value ?? 0);
    expect(ecs.get(mark, Parent)?.entity).toBe(elementOf(game, "boardSlot"));
    // The twig fills no order: it has no check.
    expect(game.app.world.projection.entityOf("board.badges", "check.i2.disc")).toBeUndefined();

    await tap(game, "deliver0");
    await until(game, () => game.app.flow.state().path === "afterOrder/show");
    await frames(game);

    expect(game.app.world.projection.entityOf("board.badges", "check.i1.disc")).toBeUndefined();

    await game.app.stop();
  });
});
