/**
 * @file The idle sway of the order cards (design §6 F10, p2): every card swings gently on its
 * clothespin, and a card whose order the board can fill swings wider. The card turns around its
 * pin (`origin: "top"` of its style), so the pin stays on the rope.
 *
 * One swing is one additive tween of the rotation whose curve is a whole sine: it leaves the
 * rest, reaches one side, crosses to the other and comes home, and nothing owns the rotation
 * afterwards, so the layout of the card and any other motion of it are never disturbed. The
 * system plays the next swing of a card when the last one has ended; the middle card swings
 * mirrored, so the rope never swings in step.
 */
import type { Anim, World } from "@moku-labs/game";
import { system, Transform, tween, type } from "@moku-labs/game";
import { defineAnimation } from "../../kit";
import { playerOf } from "../../view/systems";
import { cardKey, orderCardsOf } from "./strip";

/** How far a card swings to each side, in radians: a waiting card 1.5°, a ready one 2.5°. */
const reach = { waiting: 0.026, ready: 0.044 } as const;

/** How long one whole swing takes: out to one side, across to the other and home. */
export const SWAY_MS = 2400;

/**
 * The curve of one whole swing over the normalised time: out, across and home.
 *
 * @param t - Normalised time of the swing.
 * @returns The share of the reach the card stands at.
 * @example
 * ```ts
 * swingCurve(0.25); // 1
 * ```
 */
function swingCurve(t: number): number {
  return Math.sin(2 * Math.PI * t);
}

/**
 * Builds the animation of one whole swing of a card.
 *
 * @param name - The name of the swing, part of the animation id.
 * @param rotation - How far it reaches, in radians; negative starts to the other side.
 * @returns The animation, with one slot: the card.
 */
function swingOf(name: string, rotation: number) {
  return defineAnimation(`orders.sway.${name}`, {
    slots: { card: type<Anim.Target>() },
    build: ({ card }) =>
      tween(card, Transform, { rotation }, { ms: SWAY_MS, ease: swingCurve, additive: true })
  });
}

/** Every swing a card can play: gentle or wide, starting to the right or to the left. */
export const cardSways = {
  waiting: swingOf("waiting", reach.waiting),
  waitingMirrored: swingOf("waitingMirrored", -reach.waiting),
  ready: swingOf("ready", reach.ready),
  readyMirrored: swingOf("readyMirrored", -reach.ready)
} as const;

/**
 * The swing a card plays next: wide when it is ready, mirrored for the middle card.
 *
 * @param slot - The position of the card on the rope.
 * @param ready - Whether its order can be filled now.
 * @returns The animation to play.
 */
function swingFor(slot: number, ready: boolean) {
  const mirrored = slot % 2 === 1;

  if (ready) return mirrored ? cardSways.readyMirrored : cardSways.ready;

  return mirrored ? cardSways.waitingMirrored : cardSways.waiting;
}

/**
 * Builds the system that keeps every order card swaying. It runs in `animate` and plays the next
 * swing of each card on the screen whose last swing has ended; the rules answer whether the card
 * is ready only then, once per swing. The swing of a card that left the screen ends with it, so
 * the card swings again from rest when the board comes back.
 *
 * @param swings - The running swing of every card, by slot, kept by the plugin that registers it.
 * @param anim - The anim API that plays the swings.
 * @param projection - The projection API that finds the cards by key.
 * @returns The system.
 */
export function orderSway(
  swings: Map<number, Anim.PlayHandle>,
  anim: Anim.AnimApi,
  projection: World.ProjectionApi
) {
  return system({
    name: "orderSway",
    phase: "animate",
    query: [],
    run: (_rows, { snapshot }) => {
      let cards: ReturnType<typeof orderCardsOf> | undefined;

      for (let slot = 0; projection.entityOf("hud", cardKey(slot)) !== undefined; slot += 1) {
        if (swings.get(slot)?.active() === true) continue;

        cards ??= orderCardsOf(playerOf(snapshot).merge);

        const target = { projection: "hud", key: cardKey(slot) };

        swings.set(slot, anim.play(swingFor(slot, cards[slot]?.ready === true), { card: target }));
      }
    }
  });
}
