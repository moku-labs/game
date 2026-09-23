/**
 * @file The transient moments of the board, headless (design §6 F4, F5, F6, F10): the "Готово!"
 * stamp on a finished order, the merge burst, the sawmill squash, the twig's arc out of the
 * sawmill, and the sway and glow of an order card that becomes ready. Every spawned entity is
 * checked to leave with its timeline.
 *
 * Two moments wait for the engine and are skipped here, each naming its gap: the honey ring on the
 * selected cell (F9) and the flight of the delivered item into the card (F6).
 */

import { NineSlice, Text, Transform } from "@moku-labs/game";
import { describe, expect, it } from "vitest";
import { generatorId } from "./merge-game/tables";
import { cellBox } from "./merge-game/view/layout";
import {
  elementOf,
  frames,
  nodeOf,
  player,
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
  { id: "i2", chain: "wood", level: 1, cell: "c2_0" }
]);

/** The two cells next to the sawmill are taken, so the next twig lands on the diagonal, c1_1. */
const diagonalDrop = withItems([
  { id: "i1", chain: "wood", level: 3, cell: "c1_0" },
  { id: "i2", chain: "wood", level: 1, cell: "c0_1" }
]);

/** The honey glow of a ready card (design §2, the `selected` variant of the card style). */
const honeyGlow = 0xff_e3_9a;

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

describe("timber-motions — the Done stamp (F6)", () => {
  it("stamps the card before the reward popup opens and despawns the stamp", async () => {
    const game = await startOnBoard(player);

    await tap(game, "deliver0");

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

  it.skip("flies the delivered item into the card — engine gap: anim aims no hosted view at a root pose", async () => {
    // A board item is hosted by the board slot, so its `Transform` is slot-local; `at(card)` is a
    // root pose. `tween` writes the local `Transform` and `localPoseOf` is engine-internal, so
    // the item cannot be aimed at the card (src/plugins/anim/timeline/play.ts, tween steps).
    const game = await startOnBoard(player);
    const start = cellBox("c1_0").middle;

    await tap(game, "deliver0");

    expect(poseOf(game, "board.items", "i1")?.x).not.toBe(start.x);

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

describe("timber-motions — the ready order card (F10)", () => {
  it("sways once when it becomes ready and keeps its honey glow", async () => {
    const game = await startOnBoard(twoTwigs);
    const card = elementOf(game, "card1");

    expect(nodeOf(game.app.ui.tree(), "card1")?.state.selected).toBe(false);

    // Two twigs make the log the second order asks for.
    game.app.input.drag(
      { projection: "board.items", key: "i1" },
      { projection: "board.items", key: "i2" }
    );
    await tick();

    const tilts: number[] = [];

    for (let frame = 0; frame < 40; frame += 1) {
      await frames(game, 1);
      tilts.push(game.app.world.ecs.get(card, Transform)?.rotation ?? 0);
    }

    expect(Math.max(...tilts.map(tilt => Math.abs(tilt)))).toBeGreaterThan(0.02);
    expect(nodeOf(game.app.ui.tree(), "card1")).toMatchObject({
      state: { selected: true },
      style: { tint: honeyGlow }
    });

    await frames(game, 20);

    // The sway is over; the glow stays.
    expect(game.app.world.ecs.get(card, Transform)?.rotation).toBe(0);
    expect(game.app.world.ecs.get(card, NineSlice)?.tint).toBe(honeyGlow);

    await game.app.stop();
  });
});

describe("timber-motions — the selection (F9)", () => {
  it.skip("draws a honey stroke ring on the selected cell — engine gap: a Shape always fills", async () => {
    // `applyShape` fills every rectangle before it strokes it (src/plugins/renderer/sync/views.ts:321)
    // and `ShapeValue` has no fill alpha, so a ring over the grass would hide the cell. The ring
    // projection `board.selection` waits for a stroke-only Shape.
    const game = await startOnBoard(player);

    expect(game.app.world.projection.entitiesOf("board.selection")).toHaveLength(1);

    await game.app.stop();
  });
});
