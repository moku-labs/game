/**
 * @file The coin flight (design §6 F3): a coin gain flies coins from the popup picture to the coin
 * icon of the counter, and the counter rolls when they land. Seven coins for a reward, eight for
 * the daily gift. The coins are temporary entities the animation spawns, `coin1` … `coin8`, and
 * every one of them is despawned when the timeline ends.
 *
 * A coin flies on a curve: its x and its y are two tweens with different eases. Each tween reads
 * its start from the coin's own `Transform` when it begins, and `at()` of the target gives the end.
 * The coins are built with the kit's `Sprite`, which checks the texture key; a step that names
 * the component takes the engine's own `Sprite`, the same component object.
 */
import type { Anim } from "@moku-labs/game";
import {
  parallel,
  Sprite as SpriteComponent,
  sequence,
  set,
  spawn,
  spawned,
  stagger,
  Transform,
  tween,
  type
} from "@moku-labs/game";
import { defineAnimation, Sprite } from "../../kit";

/** How long one coin flies. The counter waits this long, so it rolls when the first coin lands. */
export const FLIGHT_MS = 520;

/** How much later each next coin leaves. */
const STAGGER_MS = 60;

/** The size of a flying coin. */
const COIN_SIZE = 72;

/** How far around the picture the coins start. */
const SPREAD = 40;

/** Above everything of the `ui` layer: the screen and every popup root. */
const COIN_ORDER = 1000;

/**
 * Where coin `index` of `count` starts, around the middle of the picture.
 *
 * @param index - The coin, from 0.
 * @param count - How many coins fly.
 * @returns The offset from the middle of the picture.
 * @example
 * ```ts
 * spreadOf(0, 4); // { x: 40, y: 0 }
 * ```
 */
function spreadOf(index: number, count: number): { x: number; y: number } {
  const angle = (index / count) * 2 * Math.PI;

  return { x: Math.round(Math.cos(angle) * SPREAD), y: Math.round(Math.sin(angle) * SPREAD) };
}

/**
 * The flight of one number of coins, as an animation of its own: the count is part of the
 * choreography, and the slots of an animation are targets only.
 *
 * @param id - The animation id.
 * @param count - How many coins fly.
 * @returns The animation, with the slots `from` (the picture) and `to` (the coin icon).
 */
function coinFlight(id: string, count: number) {
  const coins = Array.from({ length: count }, (_unused, index) => `coin${index + 1}`);

  return defineAnimation(id, {
    slots: { from: type<Anim.Target>(), to: type<Anim.Target>() },
    build: ({ from, to }, { at }) => {
      const start = at(from);
      const end = at(to);

      return sequence(
        parallel(
          ...coins.map((coin, index) => {
            const offset = spreadOf(index, count);

            return spawn(
              coin,
              [
                Sprite({
                  texture: "ui.icon-coin",
                  width: COIN_SIZE,
                  height: COIN_SIZE,
                  fit: "contain"
                }),
                Transform({ x: start.x + offset.x, y: start.y + offset.y })
              ],
              { order: COIN_ORDER + index }
            );
          })
        ),
        stagger(coins, STAGGER_MS, (coin, index) =>
          sequence(
            parallel(
              tween(
                spawned(coin),
                Transform,
                { x: end.x },
                {
                  ms: FLIGHT_MS,
                  ease: index % 2 === 0 ? "out" : "inOut"
                }
              ),
              tween(
                spawned(coin),
                Transform,
                { y: end.y },
                {
                  ms: FLIGHT_MS,
                  ease: index % 2 === 0 ? "inCubic" : "in"
                }
              ),
              tween(spawned(coin), Transform, { scale: 0.7 }, { ms: FLIGHT_MS, ease: "in" })
            ),
            // Landed: the coin is gone from sight at once, its entity leaves with the timeline.
            set(spawned(coin), SpriteComponent, { alpha: 0 })
          )
        )
      );
    }
  });
}

/** The coins of a claimed order: seven, from the reward picture to the HUD coin icon. */
export const coinsFlyReward = coinFlight("hud.coinsFlyReward", 7);

/** The coins of the daily gift: eight, from the gift picture to the Home coin icon. */
export const coinsFlyGift = coinFlight("hud.coinsFlyGift", 8);
