/**
 * @file The animation of a delivered order: what the board does while the order is filled. The
 * items left on the board bow one after the other, and the card takes the delivery with a pop.
 */
import type { Anim } from "@moku-labs/game";
import { sequence, stagger, Transform, tween, type } from "@moku-labs/game";
import { defineAnimation } from "../../kit";

/** How long one item bows. */
const ITEM_MS = 120;

/** How long the card pops. */
const CARD_MS = 140;

/** How much later each item starts. */
const STAGGER_MS = 40;

/**
 * The delivery: every item on the board bows in turn, then the order card takes the goods. The
 * slots are projection keys, so the same animation plays for any board and any card.
 */
export const deliverOrder = defineAnimation("orders.deliver", {
  slots: { items: type<Anim.Target[]>(), card: type<Anim.Target>() },
  build: ({ items, card }) =>
    sequence(
      stagger(items, STAGGER_MS, item => tween(item, Transform, { scale: 0.9 }, { ms: ITEM_MS })),
      tween(card, Transform, { scale: 1.08 }, { ms: CARD_MS, ease: "outBack" }),
      tween(card, Transform, { scale: 1 }, { ms: CARD_MS })
    )
});
