/**
 * @file The states of the board, headless (design §4, §6 F7, F11): an item or the sawmill under
 * the mouse lifts and its cell edge glows, a pressed one squashes, every legal target of the item
 * in the hand glows gold and pulses, a drop the rules refuse shakes its target and changes
 * nothing, and a sawmill with no charge or no energy is greyed with a clock badge and still
 * answers a tap, with a shake.
 *
 * The input tags are written straight into the world, the way the input plugin writes them from
 * the pointer: `PointerOver` for an idle mouse, `Pressed` from pointer down, `Held` while carried.
 */
import {
  Held,
  Order,
  Parent,
  PointerOver,
  Pressed,
  Shape,
  Sprite,
  Transform
} from "@moku-labs/game";
import { describe, expect, it } from "vitest";
import { startMoment } from "./merge-game/game";
import type { Player } from "./merge-game/state";
import { generatorId } from "./merge-game/tables";
import { cellBox } from "./merge-game/view/layout";
import type { Game } from "./timber-helpers";
import {
  elementOf,
  frames,
  player,
  playerOf,
  shows,
  startOnBoard,
  tap,
  tick,
  withItems
} from "./timber-helpers";

/** How far a hovered thing rises and how much it grows, in the board slot's units (design §4). */
const hover = { lift: 6, scale: 1.05 } as const;

/** How far a pressed thing squashes (design §4). */
const squash = 0.94;

/** How much bigger the item in the hand is drawn: `input.heldScale` of the game (design §4). */
const lifted = 1.08;

/** The grey of a sawmill that cannot give (design §6 F11). */
const grey = 0x9a_9a_9a;

/** The gold of a legal target's cell (design §4). */
const gold = 0xff_d2_4d;

/** Two twigs and a log: the twigs may merge, the log is a different level. */
const twigsAndLog = withItems([
  { id: "i1", chain: "wood", level: 1, cell: "c1_0" },
  { id: "i2", chain: "wood", level: 1, cell: "c2_0" },
  { id: "i3", chain: "wood", level: 2, cell: "c0_1" }
]);

/** Two crates: the top of the chain, which never merges. */
const twoCrates = withItems([
  { id: "i1", chain: "wood", level: 4, cell: "c1_0" },
  { id: "i2", chain: "wood", level: 4, cell: "c2_0" }
]);

/** The same board with an empty energy bar. */
const emptyBar: Player = {
  ...player,
  merge: { ...player.merge, energy: { ...player.merge.energy, value: 0 } }
};

/** The same board with a sawmill that spent its last charge and cools down for a minute. */
const spentSawmill: Player = {
  ...player,
  merge: {
    ...player.merge,
    generators: { [generatorId]: { readyAt: startMoment + 60_000, charges: 0 } }
  }
};

/**
 * The entity of one view of a board projection.
 *
 * @param game - The running game.
 * @param projection - The projection name.
 * @param key - The key of the view.
 * @returns The entity, `0` when the view is not there.
 */
function viewOf(game: Game, projection: string, key: string): number {
  return game.app.world.projection.entityOf(projection, key) ?? 0;
}

/**
 * The live `Transform` of one entity.
 *
 * @param game - The running game.
 * @param entity - The entity.
 * @returns Its transform, the defaults when it has none.
 */
function poseOf(game: Game, entity: number): { x: number; y: number; scale: number } {
  return game.app.world.ecs.get(entity, Transform) ?? Transform.defaults;
}

/**
 * The glow over one cell.
 *
 * @param game - The running game.
 * @param cell - The address of the cell.
 * @returns Its shape.
 */
function glowOf(game: Game, cell: string): { alpha: number; fill: number; fillAlpha: number } {
  return game.app.world.ecs.get(viewOf(game, "board.glows", cell), Shape) ?? Shape.defaults;
}

/**
 * The cells whose glow is drawn.
 *
 * @param game - The running game.
 * @returns Their addresses, row by row.
 */
function glowing(game: Game): string[] {
  const cells = ["c0_0", "c1_0", "c2_0", "c0_1", "c1_1", "c2_1", "c0_2", "c1_2", "c2_2"];

  return cells.filter(cell => glowOf(game, cell).alpha > 0);
}

/**
 * Runs frames and records how far one entity stood from a rest x in each of them.
 *
 * @param game - The running game.
 * @param entity - The entity to watch.
 * @param restX - Its rest x.
 * @param count - How many frames.
 * @returns The largest distance seen.
 */
async function widestSwing(game: Game, entity: number, restX: number, count = 30): Promise<number> {
  let widest = 0;

  for (let frame = 0; frame < count; frame += 1) {
    await frames(game, 1);
    widest = Math.max(widest, Math.abs(poseOf(game, entity).x - restX));
  }

  return widest;
}

describe("timber-states — hover (design §4)", () => {
  it("lifts an item under the mouse, glows its cell, and puts both back when the mouse leaves", async () => {
    const game = await startOnBoard(twigsAndLog);
    const item = viewOf(game, "board.items", "i1");
    const middle = cellBox("c1_0").middle;

    game.app.world.ecs.tag(item, PointerOver);
    await frames(game, 12);

    expect(poseOf(game, item).x).toBeCloseTo(middle.x, 3);
    expect(poseOf(game, item).y).toBeCloseTo(middle.y - hover.lift, 3);
    expect(poseOf(game, item).scale).toBeCloseTo(hover.scale, 5);
    expect(glowing(game)).toEqual(["c1_0"]);

    game.app.world.ecs.untag(item, PointerOver);
    await frames(game, 12);

    expect(poseOf(game, item).y).toBeCloseTo(middle.y, 3);
    expect(poseOf(game, item).scale).toBeCloseTo(1, 5);
    expect(glowing(game)).toEqual([]);

    await game.app.stop();
  });

  it("lifts the sawmill under the mouse the same way", async () => {
    const game = await startOnBoard(player);
    const sawmill = viewOf(game, "board.generators", generatorId);
    const middle = cellBox("c0_0").middle;

    game.app.world.ecs.tag(sawmill, PointerOver);
    await frames(game, 12);

    expect(poseOf(game, sawmill).y).toBeCloseTo(middle.y - hover.lift, 3);
    expect(poseOf(game, sawmill).scale).toBeCloseTo(hover.scale, 5);
    expect(glowing(game)).toEqual(["c0_0"]);

    await game.app.stop();
  });

  it("waits for another motion of the view to end before it lifts it", async () => {
    const game = await startOnBoard(player);
    const sawmill = viewOf(game, "board.generators", generatorId);
    const middle = cellBox("c0_0").middle;

    // The tap squashes the cabin (design §6 F5); the mouse arrives while it squashes.
    expect(game.app.input.tap(sawmill)).toBe(true);
    await tick();
    await frames(game, 1);
    game.app.world.ecs.tag(sawmill, PointerOver);
    await frames(game, 3);

    expect(poseOf(game, sawmill).scale).toBeLessThan(1);
    expect(poseOf(game, sawmill).y).toBeCloseTo(middle.y, 3);

    await frames(game, 40);

    expect(poseOf(game, sawmill).y).toBeCloseTo(middle.y - hover.lift, 3);
    expect(poseOf(game, sawmill).scale).toBeCloseTo(hover.scale, 5);

    await game.app.stop();
  });
});

describe("timber-states — pressed (design §4)", () => {
  it("squashes a pressed item and springs it back on release", async () => {
    const game = await startOnBoard(twigsAndLog);
    const item = viewOf(game, "board.items", "i1");
    const middle = cellBox("c1_0").middle;

    game.app.world.ecs.tag(item, Pressed);
    await frames(game, 8);

    expect(poseOf(game, item).scale).toBeCloseTo(squash, 5);
    expect(poseOf(game, item).y).toBeCloseTo(middle.y, 3);

    game.app.world.ecs.untag(item, Pressed);
    await frames(game, 12);

    expect(poseOf(game, item).scale).toBeCloseTo(1, 5);

    await game.app.stop();
  });

  it("goes back to the hover look when the mouse is still over the released item", async () => {
    const game = await startOnBoard(twigsAndLog);
    const item = viewOf(game, "board.items", "i1");

    game.app.world.ecs.tag(item, PointerOver);
    game.app.world.ecs.tag(item, Pressed);
    await frames(game, 8);

    expect(poseOf(game, item).scale).toBeCloseTo(squash, 5);

    game.app.world.ecs.untag(item, Pressed);
    await frames(game, 12);

    expect(poseOf(game, item).scale).toBeCloseTo(hover.scale, 5);

    await game.app.stop();
  });

  // The lifted look of the item in the hand is the input plugin's `heldScale`, 1.08 where the game
  // is composed: the grab draws the item at its rest scale times 1.08, whatever squash a press left
  // on it, mutes the scale for the drag, and the release writes the rest scale back. A headless
  // game has no canvas to drag on, so the grab and the release are written here the way the input
  // plugin writes them, like the tags above. The squash of the press is still playing at the grab:
  // the look system must cancel it, leave the carried item alone and take it back at rest.
  it("keeps the lifted look while the item is carried, right after a press", async () => {
    const game = await startOnBoard(twigsAndLog);
    const item = viewOf(game, "board.items", "i1");
    const restScale = game.app.world.projection.restOf(item, Transform)?.scale ?? 1;

    game.app.world.ecs.tag(item, Pressed);
    await frames(game, 2);
    game.app.world.ecs.untag(item, Pressed);
    game.app.world.ecs.tag(item, Held);
    game.app.world.ecs.set(item, Transform, { scale: restScale * lifted });
    await frames(game, 12);

    expect(poseOf(game, item).scale).toBeCloseTo(lifted, 5);

    game.app.world.ecs.set(item, Transform, { scale: restScale });
    game.app.world.ecs.untag(item, Held);
    await frames(game, 12);

    expect(poseOf(game, item).scale).toBeCloseTo(1, 5);

    await game.app.stop();
  });
});

describe("timber-states — drag feedback (design §6 F7)", () => {
  it("glows the cell of every legal target gold and pulses it while an item is carried", async () => {
    const game = await startOnBoard(twigsAndLog);
    const carried = viewOf(game, "board.items", "i1");

    game.app.world.ecs.tag(carried, Held);
    await frames(game, 2);

    // Only the other twig: not the carried twig itself, not the log, not the sawmill.
    expect(glowing(game)).toEqual(["c2_0"]);
    expect(glowOf(game, "c2_0")).toMatchObject({ fill: gold });
    expect(glowOf(game, "c2_0").fillAlpha).toBeGreaterThan(0);

    const alphas: number[] = [];

    for (let frame = 0; frame < 40; frame += 1) {
      await frames(game, 1);
      alphas.push(glowOf(game, "c2_0").alpha);
    }

    expect(Math.max(...alphas) - Math.min(...alphas)).toBeGreaterThan(0.2);
    expect(Math.min(...alphas)).toBeGreaterThan(0);

    game.app.world.ecs.untag(carried, Held);
    await frames(game, 2);

    expect(glowing(game)).toEqual([]);

    await game.app.stop();
  });

  it("shakes an item of a different level dropped on, and changes nothing", async () => {
    const game = await startOnBoard(twigsAndLog);
    const target = viewOf(game, "board.items", "i3");
    const rest = cellBox("c0_1").middle;
    const before = playerOf(game).merge;

    expect(
      game.app.input.drag(
        { projection: "board.items", key: "i1" },
        { projection: "board.items", key: "i3" }
      )
    ).toBe(true);
    await tick();

    expect(await widestSwing(game, target, rest.x)).toBeGreaterThan(4);
    expect(poseOf(game, target).x).toBeCloseTo(rest.x, 3);
    expect(game.app.flow.state().path).toBe("board/awaitIntent");
    expect(playerOf(game).merge).toEqual(before);

    await game.app.stop();
  });

  it("shakes a crate dropped on a crate, the top of the chain", async () => {
    const game = await startOnBoard(twoCrates);
    const target = viewOf(game, "board.items", "i2");
    const before = playerOf(game).merge;

    game.app.input.drag(
      { projection: "board.items", key: "i1" },
      { projection: "board.items", key: "i2" }
    );
    await tick();

    expect(await widestSwing(game, target, cellBox("c2_0").middle.x)).toBeGreaterThan(4);
    expect(playerOf(game).merge).toEqual(before);

    await game.app.stop();
  });

  it("shakes the sawmill when an item is dropped on it", async () => {
    const game = await startOnBoard(twigsAndLog);
    const sawmill = viewOf(game, "board.generators", generatorId);
    const before = playerOf(game).merge;

    expect(
      game.app.input.drag(
        { projection: "board.items", key: "i1" },
        { projection: "board.generators", key: generatorId }
      )
    ).toBe(true);
    await tick();

    expect(await widestSwing(game, sawmill, cellBox("c0_0").middle.x)).toBeGreaterThan(4);
    expect(playerOf(game).merge).toEqual(before);

    await game.app.stop();
  });

  it("does not shake a legal target: the merge goes through", async () => {
    const game = await startOnBoard(twigsAndLog);
    const target = viewOf(game, "board.items", "i2");

    game.app.input.drag(
      { projection: "board.items", key: "i1" },
      { projection: "board.items", key: "i2" }
    );
    await tick();

    expect(await widestSwing(game, target, cellBox("c2_0").middle.x)).toBeLessThan(0.001);
    expect(playerOf(game).merge.board.items.map(item => item.id)).toEqual(["i2", "i3"]);

    await game.app.stop();
  });
});

describe("timber-states — the disabled sawmill (design §6 F11)", () => {
  it("draws a sawmill that can give in its own colours, with no clock badge", async () => {
    const game = await startOnBoard(player);
    const sawmill = viewOf(game, "board.generators", generatorId);

    expect(game.app.world.ecs.get(sawmill, Sprite)).toMatchObject({ tint: 0xff_ff_ff, alpha: 1 });
    expect(game.app.world.projection.entitiesOf("board.clock")).toEqual([]);

    await game.app.stop();
  });

  it("greys the sawmill at 0 energy and hangs a clock badge on its cell", async () => {
    const game = await startOnBoard(emptyBar);
    const ecs = game.app.world.ecs;
    const sawmill = viewOf(game, "board.generators", generatorId);
    const cell = cellBox("c0_0");
    const badge = game.app.world.projection.entitiesOf("board.clock");
    const disc = badge.find(entity => ecs.get(entity, Sprite)?.texture === "ui.badge-level") ?? 0;

    expect(ecs.get(sawmill, Sprite)?.tint).toBe(grey);
    expect(badge.length).toBeGreaterThan(1);
    // The disc and its hands draw in the board slot, over the sawmill, inside its cell.
    expect(badge.map(entity => ecs.get(entity, Parent)?.entity)).toEqual(
      badge.map(() => elementOf(game, "boardSlot"))
    );
    expect(
      badge.every(
        entity => (ecs.get(entity, Order)?.value ?? 0) > (ecs.get(sawmill, Order)?.value ?? 0)
      )
    ).toBe(true);
    expect(poseOf(game, disc).x).toBeGreaterThan(cell.x);
    expect(poseOf(game, disc).x).toBeLessThan(cell.x + cell.size);
    expect(poseOf(game, disc).y).toBeGreaterThan(cell.y);
    expect(poseOf(game, disc).y).toBeLessThan(cell.y + cell.size);

    await game.app.stop();
  });

  it("greys the sawmill with no charge left", async () => {
    const game = await startOnBoard(spentSawmill);
    const sawmill = viewOf(game, "board.generators", generatorId);

    expect(game.app.world.ecs.get(sawmill, Sprite)?.tint).toBe(grey);
    expect(game.app.world.projection.entitiesOf("board.clock").length).toBeGreaterThan(1);

    await game.app.stop();
  });

  it("still answers a tap with a shake, and lights up again once the bar is refilled", async () => {
    const game = await startOnBoard(emptyBar);
    const sawmill = viewOf(game, "board.generators", generatorId);

    expect(game.app.input.tap(sawmill)).toBe(true);
    await tick();

    expect(await widestSwing(game, sawmill, cellBox("c0_0").middle.x)).toBeGreaterThan(4);
    expect(game.app.flow.state().path).toBe("board/energy");

    await tap(game, "energyWatch");
    await frames(game, 30);

    expect(playerOf(game).merge.energy.value).toBe(10);
    expect(shows(game, "energyScreen")).toBe(false);
    expect(game.app.world.ecs.get(sawmill, Sprite)?.tint).toBe(0xff_ff_ff);
    expect(game.app.world.projection.entitiesOf("board.clock")).toEqual([]);

    await game.app.stop();
  });
});
