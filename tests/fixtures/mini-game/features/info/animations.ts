/**
 * @file The spark burst: one entity with the `fx.spark` emitter, spawned on the middle of a target
 * above every root of the `ui` layer, held while the burst flies, then despawned with the timeline.
 * The particles still in the air fly on until they die.
 */
import type { Anim } from "@moku-labs/game";
import { sequence, spawn, Transform, type, wait } from "@moku-labs/game";
import { defineAnimation, Emitter } from "../../kit";

/** Above the Home screen and the popup root. */
const SPARK_ORDER = 1000;

/** How long the burst holds its entity. */
const HOLD_MS = 300;

export const sparkBurst = defineAnimation("info.spark", {
  slots: { from: type<Anim.Target>() },
  build: ({ from }, { at }) => {
    const middle = at(from);

    return sequence(
      spawn("spark", [Emitter({ effect: "fx.spark" }), Transform({ x: middle.x, y: middle.y })], {
        layer: "ui",
        order: SPARK_ORDER
      }),
      wait(HOLD_MS)
    );
  }
});
