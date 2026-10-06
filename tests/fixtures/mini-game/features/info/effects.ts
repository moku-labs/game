/**
 * @file The one particle effect of the game: a burst of sparks thrown out on every side, falling
 * as they shrink and fade. The effect is data: `defineEmitter` here, an `Emitter` on the entity
 * the spark animation spawns, and the `effects` plugin draws it. Headless nothing is drawn.
 */
import { defineEmitter } from "../../kit";

export const spark = defineEmitter("fx.spark", {
  textures: ["ui.fx-spark"],
  burst: 12,
  lifeMs: [350, 650],
  speed: [120, 420],
  gravity: 300,
  drag: 0.4,
  spin: [-2, 2],
  shape: { kind: "ring", radius: 40, width: 20 },
  scale: { from: 0.6, to: 0.1 },
  alpha: { from: 1, to: 0 },
  maxParticles: 16
});
