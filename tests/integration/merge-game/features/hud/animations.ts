/**
 * @file The one animation the HUD owns: the coins of a finished order fly from the order card
 * onto the counter. A choreography is plain data — the targets are projection keys, resolved when
 * the animation plays, so nothing here holds an entity.
 */
import type { Anim } from "@moku-labs/game";
import { parallel, Shape, Transform, tween, type } from "@moku-labs/game";
import { defineAnimation } from "../../kit";

/** How long the coins travel. The `coins.fly` hint carries the same number to the counter. */
export const FLIGHT_MS = 300;

/**
 * The coins fly: the card shrinks and fades while it travels to the rest pose of the counter.
 * `at` reads that pose when the animation starts, so the flight ends where the number is drawn.
 */
export const coinsFly = defineAnimation("hud.coinsFly", {
  slots: { from: type<Anim.Target>(), to: type<Anim.Target>() },
  build: ({ from, to }, tools) => {
    const landing = tools.at(to);

    return parallel(
      tween(from, Transform, { x: landing.x, y: landing.y, scale: 0.4 }, { ms: FLIGHT_MS }),
      tween(from, Shape, { alpha: 0.2 }, { ms: FLIGHT_MS })
    );
  }
});
