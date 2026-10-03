/**
 * @file The particle effects of the game (V5): a burst of stars and one of sparkles when two items
 * merge and when the stamp hits a finished order, and the steam over the sawmill chimney while it
 * can give. The effects are data: `defineEmitter` here, an `Emitter` on an entity there, and the
 * `effects` plugin draws them. Headless nothing is drawn; the `Emitter` still shows in the world.
 *
 * Each effect has one texture. Loose files are one texture source each, and a particle container
 * binds one source, so in a dev build an effect over two loose files would never draw. The stars
 * and the sparkles are two effects that start together instead of one effect over two textures.
 */
import type { Anim } from "@moku-labs/game";
import { Order, parallel, spawn, Transform } from "@moku-labs/game";
import { defineEmitter, Emitter, projection } from "../kit";
import type { Point } from "./layout";
import { cellBox, itemSize } from "./layout";
import { generatorsOf } from "./projections";

/**
 * The honey stars of a burst: a few chunky stars thrown out on every side, falling as they turn
 * and fade.
 */
export const stars = defineEmitter("fx.stars", {
  textures: ["ui.fx-star"],
  burst: 14,
  lifeMs: [500, 850],
  speed: [260, 560],
  gravity: 900,
  drag: 0.25,
  spin: [-4, 4],
  shape: { kind: "circle", radius: 30 },
  scale: { from: 0.75, to: 0.25 },
  alpha: { from: 1, to: 0 },
  maxParticles: 32
});

/** The pale sparkles of a burst: more of them, quicker and lighter than the stars. */
export const sparkles = defineEmitter("fx.sparkles", {
  textures: ["ui.fx-sparkle"],
  burst: 18,
  lifeMs: [350, 650],
  speed: [120, 420],
  gravity: 300,
  drag: 0.4,
  spin: [-2, 2],
  shape: { kind: "ring", radius: 40, width: 20 },
  scale: { from: 0.6, to: 0.1 },
  alpha: { from: 1, to: 0 },
  maxParticles: 32
});

/**
 * The steam of the sawmill: soft puffs that rise from the chimney, grow and fade. Local space, so
 * the puffs move with the board; warmed up, so the chimney smokes from the first frame.
 */
export const steam = defineEmitter("fx.steam", {
  textures: ["ui.fx-puff"],
  rate: 5,
  lifeMs: [1400, 2000],
  speed: [35, 65],
  angle: [255, 285],
  drag: 0.35,
  spin: [-0.6, 0.6],
  shape: { kind: "circle", radius: 6 },
  scale: { from: 0.3, to: 0.75 },
  alpha: { from: 0.85, to: 0 },
  tint: { from: 0xff_ff_ff, to: 0xe8_e2_da },
  space: "local",
  prewarmMs: 2000,
  maxParticles: 16
});

/**
 * Where a burst is drawn: the layer and the order of the entities that carry it. The particles take
 * the same layer and order.
 *
 * @example
 * ```ts
 * const overTheBoard: BurstPlacement = { layer: "fx", order: 12 };
 * ```
 */
export type BurstPlacement = { layer?: string; order?: number };

/**
 * The burst as timeline steps: two entities spawned on one point, one with the stars and one with
 * the sparkles. The timeline despawns them when it ends; the particles in the air fly on until
 * they die.
 *
 * @param at - The point of the burst, in the space of the layer.
 * @param placement - The layer and the order the burst is drawn at.
 * @returns The step that spawns both.
 */
export function starBurst(at: Point, placement: BurstPlacement): Anim.Step {
  return parallel(
    spawn("stars", [Emitter({ effect: "fx.stars" }), Transform({ x: at.x, y: at.y })], placement),
    spawn(
      "sparkles",
      [Emitter({ effect: "fx.sparkles" }), Transform({ x: at.x, y: at.y })],
      placement
    )
  );
}

/**
 * The top of the sawmill chimney, as a share of the item box from the middle of the cell. Read off
 * `board.generator`: the chimney cap is at (214, 3) of the 288 × 261 picture, which the box fits by
 * its width.
 */
const chimney = { x: 0.24, y: -0.45 } as const;

/**
 * Above the board screen, which is the root at order 0 of the `ui` layer, and under every popup
 * root, which counts up from 1.
 */
const STEAM_ORDER = 0.5;

/**
 * The steam over every sawmill: one entity on the chimney with the `fx.steam` emitter, smoking
 * while the sawmill can give and still while it is greyed. The board slot hosts it, so the chimney
 * is found where the slot lays the sawmill out. Its layer and order are the ones the particles take:
 * the `ui` layer above the board screen, so the meadow does not cover the steam, and under every
 * popup.
 */
export const boardSteam = projection({
  name: "board.steam",
  layer: "ui",
  from: player => generatorsOf(player),
  key: generator => generator.id,
  view: generator => {
    const { middle } = cellBox(generator.cell);

    return [
      Emitter({ effect: "fx.steam", active: generator.ready }),
      Transform({ x: middle.x + chimney.x * itemSize, y: middle.y + chimney.y * itemSize }),
      Order({ value: STEAM_ORDER })
    ];
  }
});
