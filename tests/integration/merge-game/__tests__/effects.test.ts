/**
 * @file The effects of Timber Town, headless (V5 wave A): the board feature registers its three
 * particle effects, a merge and a finished order spawn a burst of stars and sparkles that the
 * timeline takes away again, the sawmill smokes from its chimney while it can give, every primary
 * button carries the honey `Glow`, and the coins of a coin gain spin through the frames of the
 * turning coin. Plain Bun: the renderer is inert, so `effects` draws nothing and its numbers stay
 * 0, and every check reads the components on the entities. `screen-effects.test.ts` draws the same
 * game on the fake Pixi and reads the numbers.
 */
import { Emitter, Frames, Glow, Layer, Order, Parent, Transform } from "@moku-labs/game";
import { describe, expect, it } from "vitest";
import type { Game, WorldEntity } from "../../timber-helpers";
import {
  elementOf,
  frames,
  player,
  playerOf,
  shows,
  spawnedByAnim,
  startOnBoard,
  startOnHome,
  tap,
  textureOf,
  tick,
  until,
  withItems
} from "../../timber-helpers";
import { orderCardsOf } from "../features/orders/strip";
import { orderCardSize } from "../features/orders/styles";
import { primaryGlow } from "../features/ui/kit";
import { generatorId, tables } from "../tables";
import { cellBox, itemSize } from "../view/layout";

/** Two twigs side by side: a drag merges them into a log. */
const twoTwigs = withItems([
  { id: "i1", chain: "wood", level: 1, cell: "c1_0" },
  { id: "i2", chain: "wood", level: 1, cell: "c2_0" }
]);

/** The same player with an empty energy bar: the sawmill is greyed and cannot give. */
const noEnergy = {
  ...player,
  merge: { ...player.merge, energy: { ...player.merge.energy, value: 0 } }
};

/** What headless `effects` answers: nothing is drawn. */
const nothingDrawn = { particles: 0, emitters: 0, filters: 0, renderPasses: 0 };

/**
 * The entities a running timeline spawned with an `Emitter`: the two halves of a burst.
 *
 * @param game - The running game.
 * @returns Their snapshots, in spawn order.
 */
function burstsOf(game: Game): WorldEntity[] {
  return spawnedByAnim(game).filter(entity => entity.components.Emitter !== undefined);
}

/**
 * Where an entity is drawn: its `Transform` composed through its `Parent` chain, every pivot
 * applied, as `at()` of `anim` reads a rest pose.
 *
 * @param game - The running game.
 * @param entity - The entity to place.
 * @returns Its point and scale in root space.
 */
function rootPointOf(game: Game, entity: number): { x: number; y: number; scale: number } {
  const ecs = game.app.world.ecs;
  const own = ecs.get(entity, Transform) ?? Transform.defaults;
  const point = { x: own.x, y: own.y, scale: own.scale };

  for (let parent = ecs.get(entity, Parent)?.entity ?? 0; parent !== 0; ) {
    const above = ecs.get(parent, Transform) ?? Transform.defaults;
    const dx = point.x - above.pivot.x;
    const dy = point.y - above.pivot.y;
    const cos = Math.cos(above.rotation);
    const sin = Math.sin(above.rotation);

    point.x = above.x + above.scale * (dx * cos - dy * sin);
    point.y = above.y + above.scale * (dx * sin + dy * cos);
    point.scale *= above.scale;
    parent = ecs.get(parent, Parent)?.entity ?? 0;
  }

  return point;
}

describe("merge-game effects — composed", () => {
  it("registers the three effects of the board and draws nothing headless", async () => {
    const game = await startOnBoard(player);
    const ids = game.app.flow.features
      .all()
      .flatMap(feature => (feature.description.emitters ?? []).map(emitter => emitter.id));

    expect(ids).toEqual(["fx.stars", "fx.sparkles", "fx.steam"]);
    expect(game.app.effects.stats()).toEqual(nothingDrawn);
    // Every effect names a texture the manifest has and an id the game declared.
    expect(game.app.log.trace().filter(entry => entry.event.startsWith("effects:"))).toEqual([]);

    await game.app.stop();
  });
});

describe("merge-game effects — the bursts", () => {
  it("bursts stars and sparkles out of the merged item and lets the timeline take them away", async () => {
    const game = await startOnBoard(twoTwigs);
    const merged = rootPointOf(game, game.app.world.projection.entityOf("board.items", "i2") ?? 0);

    expect(
      game.app.input.drag(
        { projection: "board.items", key: "i1" },
        { projection: "board.items", key: "i2" }
      )
    ).toBe(true);
    await tick();
    await frames(game, 2);

    const bursts = burstsOf(game);

    expect(bursts.map(entity => entity.components.Emitter)).toEqual([
      { effect: "fx.stars", active: true },
      { effect: "fx.sparkles", active: true }
    ]);

    for (const burst of bursts) {
      // Over the board and the HUD, after the twelve pieces of the burst, on the merged item.
      expect(burst.components.Layer).toEqual({ name: "fx" });
      expect(burst.components.Order).toEqual({ value: 12 });
      expect(burst.components.Transform).toMatchObject({ x: merged.x, y: merged.y });
    }

    await frames(game, 40);

    expect(burstsOf(game)).toEqual([]);
    expect(game.app.effects.stats()).toEqual(nothingDrawn);

    await game.app.stop();
  });

  it("bursts stars and sparkles over the card as the stamp hits a finished order", async () => {
    const game = await startOnBoard(player);
    // A card turns around its clothespin: the burst is on the middle of the card, half a card down.
    const pin = rootPointOf(game, elementOf(game, "card0"));
    const middle = { x: pin.x, y: pin.y + (orderCardSize.height / 2) * pin.scale };

    await tap(game, "deliver0");
    await until(game, () => burstsOf(game).length > 0);

    const bursts = burstsOf(game);

    expect(game.app.flow.state().path).toBe("board/deliver");
    expect(bursts.map(entity => entity.components.Emitter)).toEqual([
      { effect: "fx.stars", active: true },
      { effect: "fx.sparkles", active: true }
    ]);

    for (const burst of bursts) {
      // In the `ui` layer over the berry stamp (1000) and its words (1001).
      expect(burst.components.Layer).toEqual({ name: "ui" });
      expect(burst.components.Order).toEqual({ value: 1002 });
      expect((burst.components.Transform as { x: number }).x).toBeCloseTo(middle.x, 3);
      expect((burst.components.Transform as { y: number }).y).toBeCloseTo(middle.y, 3);
    }

    await until(game, () => shows(game, "rewardClaim"));

    expect(burstsOf(game)).toEqual([]);

    await game.app.stop();
  });
});

describe("merge-game effects — the steam of the sawmill", () => {
  it("smokes from the chimney, hosted by the board slot, above the board screen", async () => {
    const game = await startOnBoard(player);
    const ecs = game.app.world.ecs;
    const steam = game.app.world.projection.entityOf("board.steam", generatorId) ?? 0;
    const { middle } = cellBox(tables.generators[generatorId].cell);

    expect(ecs.get(steam, Emitter)).toEqual({ effect: "fx.steam", active: true });
    expect(ecs.get(steam, Parent)?.entity).toBe(elementOf(game, "boardSlot"));
    // The particles take the host's layer and order: over the board screen (0), under a popup (1+).
    expect(ecs.get(steam, Layer)).toEqual({ name: "ui" });
    expect(ecs.get(steam, Order)).toEqual({ value: 0.5 });
    expect(ecs.get(steam, Transform)).toMatchObject({
      x: middle.x + 0.24 * itemSize,
      y: middle.y - 0.45 * itemSize
    });

    await game.app.stop();
  });

  it("stops smoking while the sawmill is greyed", async () => {
    const game = await startOnBoard(noEnergy);
    const steam = game.app.world.projection.entityOf("board.steam", generatorId) ?? 0;

    expect(game.app.world.ecs.get(steam, Emitter)).toEqual({ effect: "fx.steam", active: false });

    await game.app.stop();
  });
});

describe("merge-game effects — the glow of the primary buttons", () => {
  it("glows on Play and on the Claim of the daily gift", async () => {
    const game = await startOnHome(player);

    expect(game.app.world.ecs.get(elementOf(game, "play"), Glow)).toEqual(primaryGlow.value);
    // Wide and moderate, in the deeper honey: a halo that fades out, never a band.
    expect(primaryGlow.value).toMatchObject({ strength: 1.8, distance: 32, color: 0xf2_b4_3d });

    await tap(game, "gift");

    expect(game.app.world.ecs.get(elementOf(game, "giftClaim"), Glow)).toEqual(primaryGlow.value);

    await game.app.stop();
  });

  it("glows on the Deliver of a ready order only, and on the Claim of the reward", async () => {
    const game = await startOnBoard(player);
    const cards = orderCardsOf(playerOf(game).merge);

    expect(cards.some(card => card.ready)).toBe(true);
    expect(cards.some(card => !card.ready)).toBe(true);

    for (const card of cards) {
      const glow = game.app.world.ecs.get(elementOf(game, `deliver${card.slot}`), Glow);

      expect(glow, `deliver${card.slot}`).toEqual(card.ready ? primaryGlow.value : undefined);
    }

    await tap(game, "deliver0");
    await until(game, () => shows(game, "rewardClaim"));

    expect(game.app.world.ecs.get(elementOf(game, "rewardClaim"), Glow)).toEqual(primaryGlow.value);

    await game.app.stop();
  });
});

describe("merge-game effects — the spinning coins", () => {
  it("spins every flying coin through the seven coin frames, each from its own frame", async () => {
    const game = await startOnBoard(player);

    await tap(game, "deliver0");
    await until(game, () => shows(game, "rewardClaim"));
    await frames(game);
    await tap(game, "rewardClaim");

    const coins = spawnedByAnim(game).filter(entity => entity.components.Frames !== undefined);
    const spins = coins.map(coin => game.app.world.ecs.get(coin.id, Frames));

    expect(coins).toHaveLength(7);
    // Entity ids are reused, so the snapshot lists the coins in no fixed order.
    expect(spins.map(spin => spin?.keys[0]).toSorted()).toEqual([
      "ui.coin-spin-0",
      "ui.coin-spin-1",
      "ui.coin-spin-2",
      "ui.coin-spin-3",
      "ui.coin-spin-4",
      "ui.coin-spin-5",
      "ui.coin-spin-6"
    ]);
    expect(spins.every(spin => spin?.keys.length === 7 && spin.fps === 16)).toBe(true);

    // The loop walks: the faces change from frame to frame and no two coins show the same one.
    const before = coins.map(coin => textureOf(coin));

    await frames(game, 4);

    const after = spawnedByAnim(game)
      .filter(entity => entity.components.Frames !== undefined)
      .map(coin => textureOf(coin));

    expect(new Set(after).size).toBe(7);
    expect(after).not.toEqual(before);

    await game.app.stop();
  });
});
