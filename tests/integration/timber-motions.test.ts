/**
 * @file The transient moments of the board, headless (design §6 F4, F5, F6, F7, F9, F10): the
 * flight of the delivered item into its card and the "Готово!" stamp on a finished order, the
 * merge burst, the legal targets marked while an item is held, the sawmill squash, the twig's arc
 * out of the sawmill, the honey ring on the selected sawmill or item with the info bar that names
 * it, and the cards swaying on the rope, the ready one wider and glowing. Every spawned entity is
 * checked to leave with its timeline.
 */

import { Held, NineSlice, Order, Parent, Shape, Sprite, Text, Transform } from "@moku-labs/game";
import { describe, expect, it } from "vitest";
import { SWAY_MS } from "./merge-game/features/orders/motions";
import { orderCardSize } from "./merge-game/features/orders/styles";
import { generatorId } from "./merge-game/tables";
import { Highlighted } from "./merge-game/view/components";
import { cellBox } from "./merge-game/view/layout";
import {
  elementOf,
  frames,
  nodeOf,
  player,
  playerOf,
  resolvedOf,
  shows,
  spawnedByAnim,
  startOnBoard,
  tap,
  textureOf,
  tick,
  until,
  withItems
} from "./timber-helpers";

/** Two twigs side by side: a drag merges them into the log the second order asks for. */
const twoTwigs = withItems([
  { id: "i1", chain: "wood", level: 1, cell: "c1_0" },
  { id: "i2", chain: "wood", level: 1, cell: "c2_0" },
  { id: "i3", chain: "wood", level: 2, cell: "c2_2" }
]);

/** The two cells next to the sawmill are taken, so the next twig lands on the diagonal, c1_1. */
const diagonalDrop = withItems([
  { id: "i1", chain: "wood", level: 3, cell: "c1_0" },
  { id: "i2", chain: "wood", level: 1, cell: "c0_1" }
]);

/** How far a card swings to each side, in radians: a waiting card 1.5°, a ready one 2.5°. */
const reach = { waiting: 0.026, ready: 0.044 } as const;

/** How many frames of 16 ms one whole swing of a card takes. */
const swingFrames = Math.ceil(SWAY_MS / 16);

/**
 * The live `Transform` of one view of a board projection.
 *
 * @param game - The running game.
 * @param projection - The projection name.
 * @param key - The key of the view.
 * @returns The transform, or `undefined` when the view is not there.
 */
function poseOf(
  game: Awaited<ReturnType<typeof startOnBoard>>,
  projection: string,
  key: string
): { x: number; y: number; rotation: number; scale: number } | undefined {
  const entity = game.app.world.projection.entityOf(projection, key);

  return entity === undefined ? undefined : game.app.world.ecs.get(entity, Transform);
}

/**
 * Where an entity is drawn on the screen: its `Transform` composed through its `Parent` chain,
 * the way the renderer draws it (`position` is where the `pivot` lands).
 *
 * @param game - The running game.
 * @param entity - The entity to place.
 * @returns Its position, rotation and scale in root space.
 */
function rootPoseOf(
  game: Awaited<ReturnType<typeof startOnBoard>>,
  entity: number
): { x: number; y: number; rotation: number; scale: number } {
  const ecs = game.app.world.ecs;
  const own = ecs.get(entity, Transform) ?? { x: 0, y: 0, rotation: 0, scale: 1 };
  const pose = { x: own.x, y: own.y, rotation: own.rotation, scale: own.scale };

  for (let parent = ecs.get(entity, Parent)?.entity ?? 0; parent !== 0; ) {
    const above = ecs.get(parent, Transform) ?? Transform.defaults;
    const dx = pose.x - above.pivot.x;
    const dy = pose.y - above.pivot.y;
    const cos = Math.cos(above.rotation);
    const sin = Math.sin(above.rotation);

    pose.x = above.x + above.scale * (dx * cos - dy * sin);
    pose.y = above.y + above.scale * (dx * sin + dy * cos);
    pose.rotation += above.rotation;
    pose.scale *= above.scale;
    parent = ecs.get(parent, Parent)?.entity ?? 0;
  }

  return pose;
}

describe("timber-motions — the Done stamp (F6)", () => {
  it("stamps the card before the reward popup opens and despawns the stamp", async () => {
    const game = await startOnBoard(player);

    await tap(game, "deliver0");
    // The plank flies into the card first; the stamp follows it.
    await until(game, () => spawnedByAnim(game).length > 0);

    // The deliver node waits for the stamp: two spawned entities, the berry sign and its words.
    expect(game.app.flow.state().path).toBe("board/deliver");

    const [sign, words] = spawnedByAnim(game);

    expect(game.app.world.ecs.get(sign?.id ?? 0, NineSlice)?.texture).toBe("ui.button-berry");
    expect(game.app.world.ecs.get(words?.id ?? 0, Text)?.resolved).toBe("Готово!");

    await until(game, () => shows(game, "rewardClaim"));

    expect(game.app.flow.state().path).toBe("afterOrder/show");
    expect(spawnedByAnim(game)).toEqual([]);

    await game.app.stop();
  });

  it("flies the delivered item into the card before the give commits", async () => {
    const game = await startOnBoard(player);
    const item = game.app.world.projection.entityOf("board.items", "i1") ?? 0;
    // A card turns around its clothespin: its pose is the middle of its top edge, and the item
    // lands on the middle of the card, half a card below it.
    const pin = rootPoseOf(game, elementOf(game, "card0"));
    const card = { ...pin, y: pin.y + (orderCardSize.height / 2) * pin.scale };

    await tap(game, "deliver0");
    // The stamp is spawned once the flight has landed.
    await until(game, () => spawnedByAnim(game).length > 0);

    const landed = rootPoseOf(game, item);

    // The plank covers the card at the card's size, drawn from inside the board slot.
    expect(landed.x).toBeCloseTo(card.x, 3);
    expect(landed.y).toBeCloseTo(card.y, 3);
    expect(landed.scale).toBeCloseTo(card.scale, 5);
    expect(game.app.world.ecs.get(item, Parent)?.entity).toBe(elementOf(game, "boardSlot"));
    // The node has not committed the give yet: the plank is still in the save.
    expect(game.app.flow.state().path).toBe("board/deliver");
    expect(playerOf(game).merge.board.items.map(each => each.id)).toContain("i1");

    // The edge commits the give: the plank leaves the board from the card, shrinking where it is.
    await until(game, () => game.app.flow.state().path !== "board/deliver");
    await frames(game, 1);

    const leaving = rootPoseOf(game, item);

    expect(playerOf(game).merge.board.items.map(each => each.id)).not.toContain("i1");
    expect(leaving.x).toBeCloseTo(card.x, 3);
    expect(leaving.y).toBeCloseTo(card.y, 3);
    expect(leaving.scale).toBeLessThan(card.scale);

    await until(game, () => shows(game, "rewardClaim"));
    await game.app.stop();
  });
});

describe("timber-motions — the merge burst (F4)", () => {
  it("bursts twelve sparkles and leaves out of the merged item and despawns them", async () => {
    const game = await startOnBoard(twoTwigs);

    expect(
      game.app.input.drag(
        { projection: "board.items", key: "i1" },
        { projection: "board.items", key: "i2" }
      )
    ).toBe(true);
    await tick();
    await frames(game, 2);

    const pieces = spawnedByAnim(game);

    expect(pieces).toHaveLength(12);
    expect(pieces.filter(piece => textureOf(piece) === "ui.fx-sparkle")).toHaveLength(6);
    expect(pieces.filter(piece => textureOf(piece) === "ui.fx-leaf")).toHaveLength(6);
    expect(pieces.every(piece => (piece.components.Layer as { name?: string }).name === "fx")).toBe(
      true
    );

    await frames(game, 40);

    expect(spawnedByAnim(game)).toEqual([]);

    await game.app.stop();
  });
});

describe("timber-motions — the drag feedback (F7)", () => {
  it("marks every item the carried one may merge with while it is held, and none after", async () => {
    const game = await startOnBoard(
      withItems([
        { id: "i1", chain: "wood", level: 1, cell: "c1_0" },
        { id: "i2", chain: "wood", level: 1, cell: "c2_0" },
        { id: "i3", chain: "wood", level: 2, cell: "c0_1" }
      ])
    );
    const projection = game.app.world.projection;
    const ecs = game.app.world.ecs;
    const marked = () =>
      ["i1", "i2", "i3"].filter(key =>
        ecs.has(projection.entityOf("board.items", key) ?? 0, Highlighted)
      );

    // `Held` is the tag the input plugin writes from grab to release.
    ecs.tag(projection.entityOf("board.items", "i1") ?? 0, Held);
    await frames(game, 1);

    // Only the other twig is a legal target: not the carried twig itself, not the log.
    expect(marked()).toEqual(["i2"]);

    ecs.untag(projection.entityOf("board.items", "i1") ?? 0, Held);
    await frames(game, 1);

    expect(marked()).toEqual([]);

    await game.app.stop();
  });
});

describe("timber-motions — the sawmill tap (F5)", () => {
  it("squashes the sawmill about its middle and springs it back", async () => {
    const game = await startOnBoard(player);
    const sawmill = game.app.world.projection.entityOf("board.generators", generatorId) ?? 0;
    const middle = cellBox("c0_0").middle;

    expect(game.app.input.tap(sawmill)).toBe(true);
    await tick();
    await frames(game, 3);

    const squashed = poseOf(game, "board.generators", generatorId);

    expect(squashed?.scale).toBeLessThan(1);
    // The sprite is anchored on its middle: the squash keeps it standing on its cell.
    expect(squashed).toMatchObject({ x: middle.x, y: middle.y });

    await frames(game, 30);

    expect(poseOf(game, "board.generators", generatorId)?.scale).toBe(1);

    await game.app.stop();
  });

  it("brings the new twig out of the sawmill on an arc to its cell", async () => {
    const game = await startOnBoard(diagonalDrop);
    const sawmill = game.app.world.projection.entityOf("board.generators", generatorId) ?? 0;
    const from = cellBox("c0_0").middle;
    const to = cellBox("c1_1").middle;

    expect(game.app.input.tap(sawmill)).toBe(true);
    await until(game, () => poseOf(game, "board.items", "i3") !== undefined);
    await frames(game, 8);

    const flying = poseOf(game, "board.items", "i3") ?? { x: 0, y: 0, rotation: 0, scale: 1 };
    const across = (flying.x - from.x) / (to.x - from.x);
    const down = (flying.y - from.y) / (to.y - from.y);

    // x runs ahead of y: the twig does not travel on the straight line, it arcs.
    expect(across - down).toBeGreaterThan(0.2);

    await frames(game, 30);

    expect(poseOf(game, "board.items", "i3")).toMatchObject({ x: to.x, y: to.y, scale: 1 });

    await game.app.stop();
  });
});

/**
 * Runs frames and records the rotation of every order card in each of them.
 *
 * @param game - The running game.
 * @param count - How many frames.
 * @returns One list of rotations per card, left to right.
 */
async function tiltsOf(
  game: Awaited<ReturnType<typeof startOnBoard>>,
  count: number
): Promise<number[][]> {
  const cards = [0, 1, 2].map(slot => elementOf(game, `card${slot}`));
  const tilts: number[][] = cards.map(() => []);

  for (let frame = 0; frame < count; frame += 1) {
    await frames(game, 1);
    for (const [slot, card] of cards.entries()) {
      tilts[slot]?.push(game.app.world.ecs.get(card, Transform)?.rotation ?? 0);
    }
  }

  return tilts;
}

/**
 * The widest a card swung in a run of frames.
 *
 * @param tilts - Its rotation in each frame.
 * @returns The largest rotation to either side.
 */
function widest(tilts: readonly number[] | undefined): number {
  return Math.max(0, ...(tilts ?? []).map(tilt => Math.abs(tilt)));
}

describe("timber-motions — the cards on the rope (F10)", () => {
  it("sways every card on its clothespin, the ready one wider, the middle one mirrored", async () => {
    const game = await startOnBoard(player);
    const ecs = game.app.world.ecs;

    // The plank on the board fills the first order; the log and the crate wait.
    const tilts = await tiltsOf(game, swingFrames * 2);

    expect(widest(tilts[0])).toBeCloseTo(reach.ready, 2);
    expect(widest(tilts[1])).toBeCloseTo(reach.waiting, 2);
    expect(widest(tilts[2])).toBeCloseTo(reach.waiting, 2);
    // A quarter into the first swing the middle card leans the other way.
    const quarter = Math.floor(swingFrames / 4);

    expect(Math.sign(tilts[0]?.[quarter] ?? 0)).toBe(1);
    expect(Math.sign(tilts[1]?.[quarter] ?? 0)).toBe(-1);
    // It keeps swinging: the second swing reaches as far as the first.
    expect(widest(tilts[2]?.slice(swingFrames))).toBeCloseTo(reach.waiting, 2);
    // The card turns around the middle of its top edge, where the clothespin holds it.
    expect(ecs.get(elementOf(game, "card0"), Transform)?.pivot).toEqual({
      x: orderCardSize.width / 2,
      y: 0
    });

    await game.app.stop();
  });

  it("glows a card honey the moment its order can be filled, and swings it wider", async () => {
    const game = await startOnBoard(twoTwigs);

    expect(nodeOf(game.app.ui.tree(), "card1")?.state.selected).toBe(false);
    expect(shows(game, "card1Glow")).toBe(false);

    // Two twigs make the second log the second order asks for; the first already lies on c2_2.
    game.app.input.drag(
      { projection: "board.items", key: "i1" },
      { projection: "board.items", key: "i2" }
    );
    await tick();
    await frames(game, 3);

    expect(nodeOf(game.app.ui.tree(), "card1")?.state.selected).toBe(true);
    expect(nodeOf(game.app.ui.tree(), "card1Glow")).toMatchObject({
      style: { stroke: 0xf2_b4_3d }
    });

    // The swing it is in ends as it began; the next ones are the wide swing of a ready card.
    const tilts = await tiltsOf(game, swingFrames * 3);

    expect(widest(tilts[1]?.slice(swingFrames * 2))).toBeCloseTo(reach.ready, 2);

    await game.app.stop();
  });
});

describe("timber-motions — the selection (F9)", () => {
  it("draws a honey stroke ring on the selected cell", async () => {
    const game = await startOnBoard(player);
    const projection = game.app.world.projection;
    const ecs = game.app.world.ecs;
    const sawmill = projection.entityOf("board.generators", generatorId) ?? 0;
    const cell = cellBox("c0_0");

    // Nothing is selected before the first tap.
    expect(projection.entitiesOf("board.selection")).toEqual([]);

    expect(game.app.input.tap(sawmill)).toBe(true);
    await tick();
    await frames(game, 3);

    const rings = projection.entitiesOf("board.selection");
    const ring = rings[0] ?? 0;

    expect(rings).toHaveLength(1);
    // A ring, not a tile: the fill is not drawn, so the grass shows through.
    expect(ecs.get(ring, Shape)).toMatchObject({
      w: cell.size,
      h: cell.size,
      fillAlpha: 0,
      stroke: 0xff_c2_33,
      strokeWidth: 6
    });
    expect(ecs.get(ring, Transform)).toMatchObject({ x: cell.x, y: cell.y });
    // Hosted by the board slot, over the grass and under the sawmill.
    expect(ecs.get(ring, Parent)?.entity).toBe(elementOf(game, "boardSlot"));

    const depth = ecs.get(ring, Order)?.value ?? 0;
    const cellDepth = ecs.get(projection.entityOf("board.cells", "c0_0") ?? 0, Order)?.value ?? 0;

    expect(depth).toBeGreaterThan(cellDepth);
    expect(depth).toBeLessThan(ecs.get(sawmill, Order)?.value ?? 0);

    await game.app.stop();
  });

  it("moves the ring to a tapped item, names it in the info bar and gives it back to the sawmill", async () => {
    const game = await startOnBoard(player);
    const projection = game.app.world.projection;
    const ecs = game.app.world.ecs;
    const plankCell = cellBox("c1_0");
    const sawmillCell = cellBox("c0_0");

    expect(game.app.input.tap({ projection: "board.items", key: "i1" })).toBe(true);
    await tick();
    await frames(game, 3);

    // The select answer went through a transit node and the board rests again.
    expect(game.app.flow.state().path).toBe("board/awaitIntent");
    expect(projection.entitiesOf("board.selection")).toHaveLength(1);
    expect(ecs.get(projection.entitiesOf("board.selection")[0] ?? 0, Transform)).toMatchObject({
      x: plankCell.x,
      y: plankCell.y
    });
    expect(resolvedOf(game, "infoName")).toBe("Доска");
    expect(resolvedOf(game, "infoLevel")).toBe("Уровень 3");
    expect(ecs.get(elementOf(game, "infoIcon"), Sprite)?.texture).toBe("board.item-wood-3");
    // An item has no charges: the pips and the count of the sawmill are not drawn.
    expect(shows(game, "infoPips")).toBe(false);
    expect(shows(game, "infoCharges")).toBe(false);
    // Selecting spends nothing.
    expect(playerOf(game).merge.energy.value).toBe(7);

    const sawmill = projection.entityOf("board.generators", generatorId) ?? 0;

    expect(game.app.input.tap(sawmill)).toBe(true);
    await tick();
    await frames(game, 3);

    expect(ecs.get(projection.entitiesOf("board.selection")[0] ?? 0, Transform)).toMatchObject({
      x: sawmillCell.x,
      y: sawmillCell.y
    });
    expect(resolvedOf(game, "infoName")).toBe("Лесопилка");
    expect(resolvedOf(game, "infoCharges")).toBe("3/4");
    expect(ecs.get(elementOf(game, "infoIcon"), Sprite)?.texture).toBe("board.generator");
    expect(shows(game, "infoLevel")).toBe(false);

    await game.app.stop();
  });

  it("keeps a selected item draggable, and the selection follows the item that rose", async () => {
    const game = await startOnBoard(twoTwigs);
    const ecs = game.app.world.ecs;
    const target = cellBox("c2_0");

    expect(game.app.input.tap({ projection: "board.items", key: "i2" })).toBe(true);
    await tick();
    await frames(game, 3);

    expect(resolvedOf(game, "infoName")).toBe("Щепка");

    // The same view that answered the tap is carried: a drag onto it still merges.
    expect(
      game.app.input.drag(
        { projection: "board.items", key: "i1" },
        { projection: "board.items", key: "i2" }
      )
    ).toBe(true);
    await tick();
    await frames(game, 3);

    expect(playerOf(game).merge.board.items).toEqual([
      { id: "i2", chain: "wood", level: 2, cell: "c2_0" },
      { id: "i3", chain: "wood", level: 2, cell: "c2_2" }
    ]);
    expect(
      ecs.get(game.app.world.projection.entitiesOf("board.selection")[0] ?? 0, Transform)
    ).toMatchObject({ x: target.x, y: target.y });
    expect(resolvedOf(game, "infoName")).toBe("Бревно");
    expect(resolvedOf(game, "infoLevel")).toBe("Уровень 2");

    await game.app.stop();
  });

  it("lets the selection go with the item it named", async () => {
    const game = await startOnBoard(twoTwigs);

    expect(game.app.input.tap({ projection: "board.items", key: "i1" })).toBe(true);
    await tick();
    await frames(game, 3);

    // The selected twig is the one carried away: it merges into the other and leaves the board.
    game.app.input.drag(
      { projection: "board.items", key: "i1" },
      { projection: "board.items", key: "i2" }
    );
    await tick();
    await frames(game, 3);

    expect(game.app.world.projection.entitiesOf("board.selection")).toEqual([]);
    expect(resolvedOf(game, "infoName")).toBe("Лесопилка");
    expect(shows(game, "infoLevel")).toBe(false);

    await game.app.stop();
  });
});
